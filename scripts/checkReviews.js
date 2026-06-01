import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

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
}

async function main() {
    console.log('口コミチェック開始:', new Date().toISOString());

  const { data: stores, error } = await supabase
      .from('watched_stores')
      .select('place_id, place_name, maps_url');

  if (error) {
        console.error('watched_stores取得エラー:', JSON.stringify(error));
        throw error;
  }

  console.log(`店舗数: ${stores?.length ?? 0}`);

  const uniquePlaces = Object.values(
        Object.fromEntries(stores.map(s => [s.place_id, s]))
      );

  for (const place of uniquePlaces) {
        console.log(`チェック中: ${place.place_name}`);

      // place_idごとの最大review_timeを取得
      const { data: lastRow } = await supabase
          .from('notified_reviews')
          .select('review_time')
          .eq('place_id', place.place_id)
          .order('review_time', { ascending: false })
          .limit(1)
          .maybeSingle();

      const lastReviewTime = lastRow?.review_time ?? 0;

      let reviews;
        try {
                reviews = await fetchReviews(place.place_id);
        } catch (e) {
                console.error(`レビュー取得失敗 (${place.place_name}):`, e);
                continue;
        }

      console.log(`  取得レビュー数: ${reviews.length}, 既知の最大review_time: ${lastReviewTime}`);

      for (const review of reviews) {
              if (!review.time || review.time <= lastReviewTime) continue;

          // 新着口コミ：通知対象ユーザーを取得
          const { data: watchers, error: watchersError } = await supabase
                .from('watched_stores')
                .select('user_id')
                .eq('place_id', place.place_id);

          if (watchersError) {
                    console.error('watchersクエリエラー:', JSON.stringify(watchersError));
                    continue;
          }

          const lineUserIds = [];
              for (const w of watchers ?? []) {
                        const { data: user } = await supabase
                          .from('users')
                          .select('line_user_id')
                          .eq('id', w.user_id)
                          .maybeSingle();
                        if (user?.line_user_id) lineUserIds.push(user.line_user_id);
              }

          console.log(`新規レビュー検出: ${place.place_name} (time=${review.time}) → ${lineUserIds.length}人に通知`);

          for (const lineUserId of lineUserIds) {
                    try {
                                await sendLineNotification(lineUserId, place.place_name, place.maps_url, review);
                                console.log(`通知成功: ${lineUserId}`);
                    } catch (e) {
                                console.error(`通知失敗 (${lineUserId}):`, e.message);
                    }
          }

          // notified_reviewsに記録（review_timeカラムを使用）
          const { error: insertError } = await supabase
                .from('notified_reviews')
                .insert({ place_id: place.place_id, review_hash: `time:${review.time}`, review_time: review.time });
              if (insertError) {
                        console.error(`insert失敗:`, insertError.message);
              }
      }

      await new Promise(r => setTimeout(r, 200));
  }

  console.log('口コミチェック完了:', new Date().toISOString());
}

main().catch(e => {
    console.error('致命的エラー:', e);
    process.exit(1);
});
