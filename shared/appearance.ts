import type {AppearanceKey,Game,Theme,ThemeOverrides} from './model';

export const colorKeys=['accent','paper','ink','surface','muted','line'] as const;
export const paletteKeys=['preset',...colorKeys] as const;
export const appearanceKeys:AppearanceKey[]=[...paletteKeys,'displayFont','background'];

export function pruneThemeOverrides(shared:Theme,input:unknown):ThemeOverrides{
  if(!input||typeof input!=='object'||Array.isArray(input))return{};
  const values=input as Record<string,unknown>,result:Record<string,unknown>={};
  for(const key of appearanceKeys){
    const value=values[key];
    const valid=key==='preset'?['paper','ink','clay','forest'].includes(String(value)):
      key==='displayFont'?value==='serif'||value==='sans':
      key==='background'?typeof value==='string'&&value.length<=2000&&(value===''||/^(https?:\/\/|\/media\/)/.test(value)):
      typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
    if(valid&&value!==shared[key])result[key]=value;
  }
  return result as ThemeOverrides;
}

export function themeForRound(shared:Theme,overrides?:ThemeOverrides):Theme{
  return{...shared,...pruneThemeOverrides(shared,overrides),motion:true,sound:true,title:''};
}

export function presenterTheme(game:Pick<Game,'theme'|'rounds'|'roundIndex'|'status'>):Theme{
  return themeForRound(game.theme,game.status==='lobby'?undefined:game.rounds[game.roundIndex]?.theme);
}
