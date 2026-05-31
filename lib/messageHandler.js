import { supabase } from './supabase.js';
import { searchPlaces, getPlaceDetails } from './places.js';
import { replyMessage, textMessage } from './line.js';

async function getOrCreateUser(lineUserId) {
  const { data } = await supabase
    .from('users')
    .upsert({ line_user_id: lineUserId }, { onConflict: 'line_user_id' })
    .select('id')
    .single();
  return data;
}

async function getState(lineUserId) {
  const { data } = await supabase
    .from('conversation_states')
    .select('state, data')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  return data ?? { state: 'idle', data: null };
}

async function setState(lineUserId, state, data = null) {
  await supabase.from('conversation_states').upsert(
    { line_user_id: lineUserId, state, data, updated_at: new Date().toISOString() },
    { onConflict: 'line_user_id' }
  );
}

async function clearState(lineUserId) {
  await setState(lineUserId, 'idle', null);
}

export async function handleMessage(event) {
  const { replyToken, source, message } = event;
  const lineUserId = source.userId;
  const text = message.text?.trim() ?? '';

  const { state, data } = await getState(lineUserId);

  // --- 店舗一覧 ---
  if (text === '一覧' || text === 'リスト') {
    await clearState(lineUserId);
    const user = await getOrCreateUser(lineUserId);
    const { data: stores } = await supabase
      .from('watched_stores')
      .select('place_name')
      .eq('user_id', user.id);

    if (!stores?.length) {
      await replyMessage(replyToken, [textMessage('監視中の店舗はまだありません。\n「登録」ボタンから店舗を追加できます。')]);
    } else {
      const list = stores.map((s, i) => `${i + 1}. ${s.place_name}`).join('\n');
      await replyMessage(replyToken, [textMessage(`📍 監視中の店舗\n${list}`)]);
    }
    return;
  }

  // --- 削除フロー開始 ---
  if (text === '削除') {
    await clearState(lineUserId);
    const user = await getOrCreateUser(lineUserId);
    const { data: stores } = await supabase
      .from('watched_stores')
      .select('id, place_name')
      .eq('user_id', user.id);

    if (!stores?.length) {
      await replyMessage(replyToken, [textMessage('削除できる店舗がありません。')]);
      return;
    }

    const list = stores.map((s, i) => `${i + 1}. ${s.place_name}`).join('\n');
    await setState(lineUserId, 'awaiting_delete_selection', { stores });
    await replyMessage(replyToken, [textMessage(`削除する店舗の番号を送ってください。\n\n${list}`)]);
    return;
  }

  // --- 削除番号選択待ち ---
  if (state === 'awaiting_delete_selection') {
    const idx = parseInt(text, 10) - 1;
    const stores = data?.stores ?? [];
    if (isNaN(idx) || idx < 0 || idx >= stores.length) {
      await replyMessage(replyToken, [textMessage('正しい番号を入力してください。')]);
      return;
    }

    const store = stores[idx];
    await supabase.from('watched_stores').delete().eq('id', store.id);
    await clearState(lineUserId);
    await replyMessage(replyToken, [textMessage(`「${store.place_name}」の監視を解除しました。`)]);
    return;
  }

  // --- 登録フロー開始 ---
  if (text === '登録' || text === '追加') {
    await setState(lineUserId, 'awaiting_store_name');
    await replyMessage(replyToken, [textMessage('登録したい店舗名を入力してください')]);
    return;
  }

  // --- 店舗名入力待ち ---
  if (state === 'awaiting_store_name') {
    let places;
    try {
      places = await searchPlaces(text);
    } catch (e) {
      console.error('searchPlaces error:', e);
      await replyMessage(replyToken, [textMessage('検索中にエラーが発生しました。もう一度お試しください。')]);
      return;
    }

    if (!places.length) {
      await replyMessage(replyToken, [textMessage(`「${text}」の店舗が見つかりませんでした。別のキーワードで試してください。`)]);
      return;
    }

    const list = places.map((p, i) => `${i + 1}. ${p.name}\n   ${p.address}`).join('\n\n');
    await setState(lineUserId, 'awaiting_store_selection', { places });
    await replyMessage(replyToken, [textMessage(`以下の店舗が見つかりました。\n番号を送ってください。\n\n${list}\n\n0. キャンセル\n\n※もし店舗が見つからない場合は、正式名称で入力して下さい。`)]);
    return;
  }

  // --- 店舗選択待ち ---
  if (state === 'awaiting_store_selection') {
    if (text === '0' || text === 'キャンセル') {
      await clearState(lineUserId);
      await replyMessage(replyToken, [textMessage('キャンセルしました。')]);
      return;
    }

    const places = data?.places ?? [];
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= places.length) {
      await replyMessage(replyToken, [textMessage('正しい番号を入力してください。')]);
      return;
    }

    const selected = places[idx];
    let details;
    try {
      details = await getPlaceDetails(selected.placeId);
    } catch (e) {
      console.error('getPlaceDetails error:', e);
      await replyMessage(replyToken, [textMessage('詳細取得中にエラーが発生しました。もう一度お試しください。')]);
      return;
    }

    const user = await getOrCreateUser(lineUserId);
    const { error } = await supabase.from('watched_stores').insert({
      user_id: user.id,
      place_id: selected.placeId,
      place_name: selected.name,
      maps_url: details.url ?? `https://www.google.com/maps/place/?q=place_id:${selected.placeId}`,
    });

    await clearState(lineUserId);

    if (error) {
      console.error('insert error:', error);
      await replyMessage(replyToken, [textMessage('登録中にエラーが発生しました。もう一度お試しください。')]);
    } else {
      await replyMessage(replyToken, [textMessage(`✅「${selected.name}」を登録しました！\n新しい口コミが投稿されたらお知らせします。`)]);
    }
    return;
  }

  // --- デフォルト ---
  await clearState(lineUserId);
  await replyMessage(replyToken, [textMessage('リッチメニューのボタンから操作してください。')]);
}
