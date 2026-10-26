import type { TeamColors, TeamData } from '../core/teams.ts';

export type UniformPattern = 'pinstripe' | 'piping' | 'shoulder' | 'side';

export interface UniformLook extends TeamColors {
  pants: string;
  trim: string;
  pattern: UniformPattern;
  /** 帽子と胸文字を読みやすくする色。 */
  lettering: string;
}

type Design = { home: [string, string, UniformPattern]; visitor: [string, string, UniformPattern] };

/** 架空の12球団それぞれのホーム／ビジター。地色・装飾色・仕立てを独立して定める。 */
const DESIGNS: Record<string, Design> = {
  maikai: { home: ['#f5f3e9', '#357a36', 'pinstripe'], visitor: ['#245b37', '#bee276', 'shoulder'] },
  jogawa: { home: ['#f7f4ed', '#bd1738', 'piping'], visitor: ['#202127', '#d72e48', 'side'] },
  smarlins: { home: ['#f4f9fa', '#65a9c9', 'shoulder'], visitor: ['#236080', '#b5e5f1', 'piping'] },
  hanazakura: { home: ['#fff7f7', '#9b4266', 'piping'], visitor: ['#713248', '#e8afc2', 'side'] },
  kamiyama: { home: ['#f8f6ea', '#d3a600', 'pinstripe'], visitor: ['#202c48', '#f2c300', 'shoulder'] },
  facrom: { home: ['#eef0f2', '#243d70', 'piping'], visitor: ['#152349', '#c3d0e1', 'side'] },
  kanbu: { home: ['#f7f5eb', '#dca212', 'pinstripe'], visitor: ['#242426', '#e5b632', 'shoulder'] },
  manyama: { home: ['#eeeae1', '#a8862a', 'piping'], visitor: ['#1e1f23', '#c9a84f', 'pinstripe'] },
  onetar: { home: ['#f2f8f7', '#209ba5', 'side'], visitor: ['#124957', '#63d2d6', 'piping'] },
  sackstars: { home: ['#f7f4e9', '#b59139', 'pinstripe'], visitor: ['#545b64', '#e4bd61', 'shoulder'] },
  merry: { home: ['#f8f3e8', '#986623', 'piping'], visitor: ['#4b3228', '#d6aa62', 'side'] },
  kanenodunk: { home: ['#f8f5e9', '#b99747', 'pinstripe'], visitor: ['#252525', '#d4b965', 'piping'] }
};

export function uniformLook(team: TeamData, side: 'home' | 'visitor'): UniformLook {
  const colors = team.colors;
  const selected = DESIGNS[team.id]?.[side];
  const [uniform, trim, pattern] = selected ?? [side === 'home' ? colors.uniform : colors.primary, colors.secondary, 'piping'];
  const dark = side === 'visitor';
  return {
    ...colors,
    uniform,
    pants: dark ? uniform : '#f3f0e9',
    cap: dark ? uniform : colors.cap,
    trim,
    pattern,
    lettering: dark ? '#f7f5ee' : colors.cap
  };
}
