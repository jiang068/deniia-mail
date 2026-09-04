# 主题包

每个子目录是一个独立主题包，包含配色、品牌名称和站点文案：

```text
src/themes/
  deniia/theme.js
  ocean/theme.js
```

新增主题时复制一个目录，导出同样结构的主题对象，再在 `src/themes/index.js` 注册。主题包不需要修改页面组件；主题模式和强调色会自动覆盖包内对应变量。
