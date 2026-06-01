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
          if (!reviews.length) continue;

        const { data: lastData } = await supabase
            .from('notified_reviews')
            .select('review_time')
            .eq('place_id', place_id)
            .order('review_time', { ascending: false })
            .limit(1);

        const lastReviewTime = lastData?.[0]?.review_time ?? 0;

        if (lastReviewTime === 0) {
                  // 初回: 通知せず最新のtimeだけ登録
            const latest = reviews.reduce((a, b) => (a.time > b.time ? a : b));
                  const { error } = await supabase.from('notified_reviews').upsert({
                              place_id,
                              review_hash: `init_${place_id}`,
                              review_time: latest.time ?? 0,
                  });
                  if (error) console.log(`初回登録失敗: ${place_name}:`, error.message);
                  else console.log(`初回登録完了: ${place_name} time=${latest.time}`);
                  continue;
        }

        const newReviews = reviews.filter(r => (r.time ?? 0) > lastReviewTime);

        if (newReviews.length === 0) {
                  console.log(`新着なし: ${place_name}`);
                  continue;
        }

        for (const review of newReviews) {
                  try {
                              await sendLineNotification(userId, place_name, maps_url, review);
                              const { error } = await supabase.from('notified_reviews').upsert({
                                            place_id,
                                            review_hash: `${place_id}_${review.time}`,
                                            review_time: review.time ?? 0,
                              });
                              if (error) console.log(`insert失敗: ${error.message}`);
                              else console.log(`通知・登録完了: ${place_name}`);
                  } catch (e) {
                              console.error(`通知失敗: ${place_name}:`, e.message);
                  }
        }
  }
}

main().catch(console.error);
