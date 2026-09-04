const deniiaTheme = {
  id: 'deniia',
  name: 'Deniia',
  description: '柔和、清晰的邮件工作台',
  preview: { light: '#fdf2f8', dark: '#171325', accent: '#ec4899' },
  brand: {
    name: 'Deniia Mail',
    shortName: 'Deniia',
    tagline: 'Deniia 临时邮箱',
    description: '隐私优先的临时邮箱。一次性的地址，拦截追踪器，保护你的收件箱不被骚扰。',
  },
  modes: {
    light: {
      '--c-app': '#fdf2f8', '--c-bg-opacity': '.55',
      '--c-surface': '#ffffff', '--c-surface2': '#fff8fc', '--c-surface3': '#fce7f3', '--c-border': '#f1c9df',
      '--c-text': '#3f2436', '--c-text-sub': '#6f5064', '--c-text-faint': '#8d6f81',
      '--c-accent': '#ec4899', '--c-accent-hover': '#db2777', '--c-accent-soft': '#fce7f3', '--c-accent-ink': '#ffffff',
      '--c-danger': '#be123c', '--c-danger-ink': '#ffffff', '--c-danger-soft': '#ffe4e6', '--c-warn': '#a16207', '--c-warn-soft': '#fef3c7',
      '--c-green': '#15803d', '--c-green-soft': '#dcfce7', '--c-blue': '#1d4ed8', '--c-blue-soft': '#dbeafe',
      '--mail-body-bg': '#ffffff', '--mail-body-text': '#17202a', '--mail-body-link': '#075985',
      '--shadow-panel': '0 12px 32px -14px rgba(190, 24, 93, .28)',
    },
    dark: {
      '--c-app': '#171325', '--c-bg-opacity': '.65',
      '--c-surface': '#221a36', '--c-surface2': '#1c152e', '--c-surface3': '#2c2145', '--c-border': '#493b68',
      '--c-text': '#f4f0ff', '--c-text-sub': '#c2b6df', '--c-text-faint': '#9c8bbb',
      '--c-accent': '#a78bfa', '--c-accent-hover': '#8b5cf6', '--c-accent-soft': '#382d5d', '--c-accent-ink': '#ffffff',
      '--c-danger': '#fb7185', '--c-danger-ink': '#17202a', '--c-danger-soft': '#4c203b', '--c-warn': '#fbbf24', '--c-warn-soft': '#493612',
      '--c-green': '#4ade80', '--c-green-soft': '#173b26', '--c-blue': '#60a5fa', '--c-blue-soft': '#1d3356',
      '--mail-body-bg': '#ffffff', '--mail-body-text': '#17202a', '--mail-body-link': '#075985',
      '--shadow-panel': '0 12px 32px -12px rgba(0, 0, 0, .64)',
    },
  },
};

export default deniiaTheme;
