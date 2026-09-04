const oceanTheme = {
  id: 'ocean',
  name: 'Ocean',
  description: '冷静、通透的蓝绿色主题',
  preview: { light: '#eef8fb', dark: '#0d1b22', accent: '#0f8ea3' },
  brand: {
    name: 'Ocean Mail',
    shortName: 'Ocean',
    tagline: 'Ocean 临时邮箱',
    description: '清爽、可靠的临时邮箱，帮助你把重要邮件和外界噪音分开。',
  },
  modes: {
    light: {
      '--c-app': '#eef8fb', '--c-bg-opacity': '.55',
      '--c-surface': '#ffffff', '--c-surface2': '#f5fbfc', '--c-surface3': '#dff3f7', '--c-border': '#b8dce4',
      '--c-text': '#12313b', '--c-text-sub': '#41616b', '--c-text-faint': '#66838c',
      '--c-accent': '#0f8ea3', '--c-accent-hover': '#0b7285', '--c-accent-soft': '#d9f3f6', '--c-accent-ink': '#ffffff',
      '--c-danger': '#be3f4d', '--c-danger-ink': '#ffffff', '--c-danger-soft': '#ffe5e7', '--c-warn': '#a16207', '--c-warn-soft': '#fff4d6',
      '--c-green': '#16734a', '--c-green-soft': '#dcf8e8', '--c-blue': '#1d5fc4', '--c-blue-soft': '#e0edff',
      '--mail-body-bg': '#ffffff', '--mail-body-text': '#17202a', '--mail-body-link': '#075985',
      '--shadow-panel': '0 12px 32px -14px rgba(15, 142, 163, .25)',
    },
    dark: {
      '--c-app': '#0d1b22', '--c-bg-opacity': '.65',
      '--c-surface': '#132a33', '--c-surface2': '#10232b', '--c-surface3': '#1b3a45', '--c-border': '#2d5864',
      '--c-text': '#e7f8fb', '--c-text-sub': '#b7d7de', '--c-text-faint': '#8aafb8',
      '--c-accent': '#49c9d8', '--c-accent-hover': '#2caab9', '--c-accent-soft': '#16424d', '--c-accent-ink': '#06232b',
      '--c-danger': '#ff8790', '--c-danger-ink': '#17202a', '--c-danger-soft': '#4b2730', '--c-warn': '#f4c95d', '--c-warn-soft': '#4b3a1b',
      '--c-green': '#66dda0', '--c-green-soft': '#163c2d', '--c-blue': '#76b4ff', '--c-blue-soft': '#1b385b',
      '--mail-body-bg': '#ffffff', '--mail-body-text': '#17202a', '--mail-body-link': '#075985',
      '--shadow-panel': '0 12px 32px -12px rgba(0, 0, 0, .68)',
    },
  },
};

export default oceanTheme;
