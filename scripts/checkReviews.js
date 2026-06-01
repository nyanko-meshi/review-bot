import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

function makeHash(placeId, review) {
        const raw = `${placeId}_${review.author_name}_${review.rating}_${review.time ?? 0}`;
        return crypto.createHash('md5').update(raw).digest('hex');
}

async function fetchReviews(placeId) {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&language=ja&sort_reviews=newest&key=${process.env.GOOGLE_PLACES_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.result?.reviews ?? [];
}

async function sendLineNotification(userId, placeName, mapsUrl, review) {
        const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        const text = `📢 新しい口コミが投稿されました！
        📍 ${placeName}
        👤 ${review.author_name}
        ${stars}
        💬 ${review.text ? review.text.slice(0, 100) + (review.text.length > 100 ? '…' : '') : '（本文なし）'}
        👇 口コミを見る
        ${mapsUrl}`;

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                        to: userId,
                        messages: [{ type: 'text', text }],
            }),
  });
        if (!res.ok) {
                  const body = await res.text();
                  throw new Error(`LINE API エラー: ${res.status} ${body}`);
        }
        console.log(`通知成功: ${userId}`);
}

async function main() {
        const { data: stores } = await supabase
          .from('watched_stores')
          .select('*, users(line_user_id)');

  if (!stores || stores.length === 0) {
            console.log('監視店舗なし');
            return;
  }

  for (const store of stores) {
            const { place_id, place_name, maps_url, users } = store;
            const userId = users?.line_user_id;
            if (!userId) continue;

          const reviews = await fetchReviews(place_id);
            if (!reviews.length) {
                        console.log(`口コミ取得0件: ${place_name}`);
                        continue;
            }

          // DBに登録済みのhash一覧を取得
          const { data: existingRows } = await supabase
              .from('notified_reviews')
              .select('review_hash')
              .eq('place_id', place_id);

          const existingHashes = new Set((existingRows ?? []).map(r => r.review_hash));
            const dbIsEmpty = existingHashes.size === 0;

          let notifiedCount = 0;

          for (const review of reviews) {
                      const hash = makeHash(place_id, review);

              if (existingHashes.has(hash)) {
                            // 登録済み → スキップ
                        continue;
              }

              if (!dbIsEmpty) {
                            // 新着口コミ → 通知
                        try {
                                        await sendLineNotification(userId, place_name, maps_url, review);
                                        notifiedCount++;
                        } catch (e) {
                                        console.error(`通知失敗: ${place_name}:`, e.message);
                        }
              }

              // DBに登録（初回・新着とも）
              const { error } = await supabase.from('notified_reviews').upsert({
                            place_id,
                            review_hash: hash,
                            review_time: review.time ?? 0,
              });
                      if (error) console.log(`insert失敗: ${error.message}`);
          }

          if (dbIsEmpty) {
                      console.log(`初回登録完了: ${place_name} (${reviews.length}件)`);
          } else if (notifiedCount > 0) {
                      console.log(`新着通知完了: ${place_name} (${notifiedCount}件)`);
          } else {
                      console.log(`新着なし: ${place_name}`);
          }
  }
}

main().catch(console.error);
