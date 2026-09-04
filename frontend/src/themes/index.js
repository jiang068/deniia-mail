// 主题包注册表：新增主题时复制 src/themes/<name> 文件夹，导出主题后在此注册即可。
import deniia from './deniia/theme.js';
import ocean from './ocean/theme.js';

export const themePacks = [deniia, ocean];
export const themePackMap = Object.fromEntries(themePacks.map(theme => [theme.id, theme]));
export const defaultThemePack = deniia;
