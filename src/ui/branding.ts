// 架空の12球団の紋章とマスコット。SVGをコードで描き、画面サイズを問わず鮮明に表示する。
import { inkOn, textColor, type TeamData } from '../core/teams.ts';

interface Brand {
  name: string;
  motif: string;
  head: string;
  tail?: string;
}

const BRANDS: Record<string, Brand> = {
  maikai: {
    name: 'グリーン・フォックス',
    motif: '<path d="M37 40v24l12-8 13 8V40L49 48z"/><path d="M70 39q15 11 0 23M76 34q22 16 0 33" fill="none" stroke-width="4"/>',
    head: '<path d="M36 36 33 15 49 27 59 24 71 27 87 15 84 36Q92 56 74 65L60 72 46 65Q28 56 36 36Z" fill="#d6b183"/><path d="M39 27 35 18 48 32M81 27 85 18 72 32" fill="#f4dcc0"/><path d="M46 56q14 16 28 0l-14 12z" fill="#f7e7d1"/><circle cx="50" cy="45" r="3"/><circle cx="70" cy="45" r="3"/><path d="m57 55 3 3 3-3z"/>',
    tail: '<path d="M80 84q34-10 25-32Q94 68 80 68" fill="#d6b183" stroke="#f5e8d3" stroke-width="3"/>'
  },
  jogawa: {
    name: 'レッド・ベア',
    motif: '<path d="M49 32h22v9H49zM45 44q0-7 8-7h14q8 0 8 7v27q0 8-8 8H53q-8 0-8-8z"/><path d="M50 55h20" fill="none" stroke-width="3"/>',
    head: '<circle cx="38" cy="29" r="10" fill="#9b6546"/><circle cx="82" cy="29" r="10" fill="#9b6546"/><circle cx="60" cy="45" r="29" fill="#b77b54"/><ellipse cx="60" cy="57" rx="14" ry="10" fill="#e2b896"/><circle cx="50" cy="44" r="3"/><circle cx="70" cy="44" r="3"/><ellipse cx="60" cy="54" rx="5" ry="3"/><path d="M60 57v5m-6 0q6 5 12 0" fill="none" stroke="#30251f" stroke-width="2"/>'
  },
  smarlins: {
    name: 'ブルー・マーリン',
    motif: '<path d="M34 60q23-24 50 0-27 24-50 0zM56 49l8-19 7 21M35 60 22 47v26z"/><circle cx="73" cy="57" r="2"/>',
    head: '<path d="M29 51q11-29 38-26l8-18 6 23q13 9 10 25L70 69 45 67z" fill="#63a9c6"/><path d="M76 51 106 57 77 59" fill="#b9e6ef"/><path d="M35 59q24 13 44 0l-15 10-25-2z" fill="#d7f3f5"/><circle cx="68" cy="43" r="3"/>'
  },
  hanazakura: {
    name: 'さくら・ラビット',
    motif: '<path d="M60 33q9-12 15 0-4 10-15 11 13-3 17 8-8 9-17 4 8 10 0 19-10-4-9-15-6 11-17 5 0-11 12-15-13 0-10-12 11-5 18 5z"/><circle cx="60" cy="51" r="5"/>',
    head: '<ellipse cx="45" cy="19" rx="8" ry="22" fill="#f2e4e5" transform="rotate(-15 45 19)"/><ellipse cx="76" cy="19" rx="8" ry="22" fill="#f2e4e5" transform="rotate(15 76 19)"/><ellipse cx="45" cy="18" rx="3" ry="14" fill="#dc9caf" transform="rotate(-15 45 18)"/><ellipse cx="76" cy="18" rx="3" ry="14" fill="#dc9caf" transform="rotate(15 76 18)"/><circle cx="60" cy="48" r="27" fill="#f2e4e5"/><circle cx="50" cy="45" r="3"/><circle cx="70" cy="45" r="3"/><path d="m56 55 4 3 4-3M60 58v4" fill="none" stroke="#844456" stroke-width="2"/>'
  },
  kamiyama: {
    name: 'マウンテン・イーグル',
    motif: '<path d="m27 72 24-30 10 13 12-21 21 38H27z"/><path d="m49 45 4 11 8-1m12-17 4 14 5 2" fill="none" stroke-width="3"/>',
    head: '<path d="M35 31q25-24 50 0l5 26-31 15-28-19z" fill="#8b6b45"/><path d="M43 29q18-12 36 0l-3 16-17 10-17-9z" fill="#f1ead7"/><path d="m61 47 18 5-17 11-5-8z" fill="#e0aa32"/><path d="M47 43h9m12 0h9" stroke="#283345" stroke-width="4"/>'
  },
  facrom: {
    name: 'エックス・ロボ',
    motif: '<path d="m36 35 17 18-17 18h12l12-12 12 12h12L67 53l17-18H72L60 47 48 35z"/>',
    head: '<rect x="31" y="26" width="58" height="43" rx="10" fill="#bac9dc"/><path d="M60 26V15m-6 0h12" stroke="#9aaed0" stroke-width="5"/><rect x="39" y="38" width="42" height="18" rx="5" fill="#192a50"/><path d="M45 47h10m10 0h10" stroke="#62d7e2" stroke-width="5"/><path d="M52 61h16" stroke="#4d627f" stroke-width="3"/>'
  },
  kanbu: {
    name: 'タイガー・カン',
    motif: '<path d="M39 37q21-14 42 0v21q-4 20-21 22-17-2-21-22z"/><path d="m43 43 11 6-11 5m34-11-11 6 11 5M54 64h12" fill="none" stroke-width="4"/>',
    head: '<path d="M37 30 33 17l16 8q11-5 22 0l16-8-4 13q10 13 3 28L60 72 34 58q-7-15 3-28z" fill="#e7ad45"/><path d="m41 32 8 9-12-3m42-6-8 9 12-3M60 27v13" stroke="#3b3027" stroke-width="5"/><ellipse cx="60" cy="58" rx="12" ry="9" fill="#f2e5c7"/><circle cx="50" cy="48" r="3"/><circle cx="70" cy="48" r="3"/><path d="m56 56 4 3 4-3z"/>'
  },
  manyama: {
    name: 'ゴールド・グース',
    motif: '<path d="M53 72V37q3-13 14-9 9 4 4 13l-8 6v25zM44 72h32M67 36l19 4-18 7"/>',
    head: '<path d="M52 72q-11-20-5-39 4-18 19-17 15 1 13 17-1 14-14 21l3 18z" fill="#ece9df"/><path d="m73 35 23 4-21 10" fill="#d5a242"/><circle cx="67" cy="30" r="3"/><path d="M55 59q8 4 14 0" fill="none" stroke="#b9b4a8" stroke-width="2"/>'
  },
  onetar: {
    name: 'アクア・オッター',
    motif: '<path d="M35 57q0-19 25-19t25 19q0 20-25 20T35 57z"/><path d="M44 57h32m-18 3 2 3 2-3" fill="none" stroke-width="3"/>',
    head: '<circle cx="37" cy="32" r="9" fill="#8a7565"/><circle cx="83" cy="32" r="9" fill="#8a7565"/><ellipse cx="60" cy="49" rx="30" ry="24" fill="#9a816d"/><ellipse cx="60" cy="57" rx="18" ry="11" fill="#d8c4ae"/><circle cx="49" cy="46" r="3"/><circle cx="71" cy="46" r="3"/><path d="m56 54 4 3 4-3zM41 57l-13-3m13 7-13 3m51-7 13-3m-13 7 13 3" stroke="#3e4141" stroke-width="2" fill="none"/>'
  },
  sackstars: {
    name: 'スター・サックス',
    motif: '<path d="m60 29 9 20 22 3-16 15 4 23-19-11-19 11 4-23-16-15 22-3z"/><path d="M51 58q12 8 18 0" fill="none" stroke-width="3"/>',
    head: '<path d="m60 14 10 21 23 3-17 17 4 22-20-11-20 11 4-22-17-17 23-3z" fill="#e6c457"/><path d="M47 48h9m10 0h9" stroke="#403a32" stroke-width="4"/><path d="M51 58q9 8 18 0" fill="none" stroke="#403a32" stroke-width="2"/>'
  },
  merry: {
    name: 'メリー・スクイレル',
    motif: '<path d="M49 39q-17-10-20 11 1 19 24 20h15q19-1 20-20-3-21-20-11"/><path d="M60 46v20m-10-11h20" fill="none" stroke-width="4"/>',
    head: '<path d="M37 32 31 17l18 8q11-5 22 0l18-8-6 15q8 17-4 32L60 71 41 64q-12-15-4-32z" fill="#a87343"/><path d="M42 40q18-9 36 0l-4 20-14 9-14-9z" fill="#e4b98a"/><circle cx="49" cy="44" r="3"/><circle cx="71" cy="44" r="3"/><path d="m56 54 4 3 4-3z"/>',
    tail: '<path d="M79 84q31-27 17-42 15 6 10 25-4 21-27 26" fill="#a87343"/>'
  },
  kanenodunk: {
    name: 'ゴールド・ラクーン',
    motif: '<path d="m37 43 23-16 23 16-6 30H43z"/><path d="m43 51 17 11 17-11" fill="none" stroke-width="4"/>',
    head: '<path d="M35 31 27 18l19 5q14-8 28 0l19-5-8 13q6 19-8 34L60 72 43 65Q29 50 35 31z" fill="#b49c69"/><path d="M39 42q10-7 19 1l-8 11-13-3m46-9q-10-7-19 1l8 11 13-3" fill="#45423b"/><ellipse cx="60" cy="59" rx="13" ry="9" fill="#eee5cb"/><circle cx="50" cy="45" r="3" fill="#fff"/><circle cx="70" cy="45" r="3" fill="#fff"/><path d="m56 57 4 3 4-3z"/>'
  }
};

export const mascotName = (id: string): string => BRANDS[id]?.name ?? 'チームマスコット';

/** 球団略称と固有モチーフを組み合わせた紋章。 */
export function teamLogoSvg(team: TeamData): string {
  const brand = BRANDS[team.id];
  const base = textColor(team.colors);
  const highlight = inkOn(base);
  return `<svg class="team-logo" viewBox="0 0 120 120" role="img" aria-label="${team.nameJa}のロゴ" xmlns="http://www.w3.org/2000/svg"><path d="M60 4 110 22v47q-8 31-50 47Q18 100 10 69V22z" fill="${base}" stroke="${team.colors.secondary}" stroke-width="6"/><path d="M60 12 102 27v39q-7 25-42 40Q25 91 18 66V27z" fill="none" stroke="${highlight}" stroke-opacity=".7" stroke-width="2"/><g fill="${highlight}" stroke="${team.colors.secondary}" transform="translate(12 3) scale(.8)">${brand?.motif ?? '<circle cx="60" cy="55" r="22"/>'}</g><rect x="22" y="85" width="76" height="20" rx="10" fill="${team.colors.secondary}"/><text x="60" y="100" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="900" letter-spacing="2" fill="${inkOn(team.colors.secondary)}">${team.abbr}</text></svg>`;
}

/** 球団ごとに違う動物・ロボット・星のマスコット。 */
export function teamMascotSvg(team: TeamData): string {
  const brand = BRANDS[team.id];
  const base = textColor(team.colors);
  const accent = team.colors.secondary;
  return `<svg class="team-mascot" viewBox="0 0 120 120" role="img" aria-label="${team.nameJa}のキャラクター ${mascotName(team.id)}" xmlns="http://www.w3.org/2000/svg"><g stroke="#302b2a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${brand?.tail ?? ''}<path d="M38 77q22-14 44 0l8 35H30z" fill="${base}"/><path d="M39 78 28 91m53-13 11 13" fill="none" stroke="${accent}" stroke-width="9"/><path d="M30 112h60M59 76v36" fill="none" stroke="${accent}" stroke-width="3"/><path d="M39 106v10m42-10v10" stroke="${base}" stroke-width="10"/>${brand?.head ?? '<circle cx="60" cy="48" r="27" fill="#d6b183"/>'}<path d="M42 25q18-15 36 0" fill="none" stroke="${base}" stroke-width="6"/></g><text x="60" y="97" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="900" fill="${inkOn(base)}">${team.abbr}</text></svg>`;
}
