import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

function reviewHash(placeId, review) {
    return crypto
      .createHash('sha256')
      .update(`${placeId}:${review.author_name}:${review.time}`)
      .digest('hex');
}

async function fetchReviews(placeId) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&language=ja&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.result?.reviews ?? [];
}

async function sendLineNotification(userId, placeName, mapsUrl) {
    await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
                  to: userId,
                  messages: [
                    {
                                type: 'text',
                                text: `📢 新しい口コミが投稿されました！\n\n📍 ${placeName}\n\n👇 口コミを見る\n${mapsUrl}`,
                    },
                          ],
          }),
    });
}

async function main() {
    console.log('口コミチェック開始:', new Date().toISOString());

  // 監視中のすべての店舗を取得（重複排除）
  console.log('watched_storesを取得中...');
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
        let reviews;
        try {
                reviews = await fetchReviews(place.place_id);
        } catch (e) {
                console.error(`レビュー取得失敗 (${place.place_name}):`, e);
                continue;
        }

      for (const review of reviews) {
              const hash = reviewHash(place.place_id, review);

          // すでに通知済みか確認
          const { data: existing } = await supabase
                .from('notified_reviews')
                .select('id')
                .eq('place_id', place.place_id)
                .eq('review_hash', hash)
                .maybeSingle();

          if (existing) continue;

          // 新規レビュー → 通知対象ユーザーを取得
          console.log('watchersクエリ実行中...');
              const { data: watchers, error: watchersError } = await supabase
                .from('watched_stores')
                .select('user_id')
                .eq('place_id', place.place_id);

          if (watchersError) {
                    console.error('watchersクエリエラー:', JSON.stringify(watchersError));
                    continue;
          }

          const userIds = watchers?.map(w => w.user_id) ?? [];

          // usersテーブルからLINE IDを取得
          const lineUserIds = [];
              for (const userId of userIds) {
                        const { data: user } = await supabase
                          .from('users')
                          .select('line_user_id')
                          .eq('id', userId)
                          .maybeSingle();
                        if (user?.line_user_id) lineUserIds.push(user.line_user_id);
              }

          console.log(`新規レビュー検出: ${place.place_name} → ${lineUserIds.length}人に通知`);

          for (const lineUserId of lineUserIds) {
                    try {
                                await sendLineNotification(lineUserId, place.place_name, place.maps_url);
                    } catch (e) {
                                console.error(`通知失敗 (${lineUserId}):`, e);
                    }
          }

          // 通知済みとして記録
          await supabase
                .from('notified_reviews')
                .insert({ place_id: place.place_id, review_hash: hash });
      }

      // Places API のレート制限対策
      await new Promise(r => setTimeout(r, 200));
  }

  console.log('口コミチェック完了:', new Date().toISOString());
}

main().catch(e => {
    console.error('致命的エラー:', e);
    process.exit(1);
});
