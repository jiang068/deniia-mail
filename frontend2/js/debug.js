// ============================================================
//  诊断日志 (debug.js) —— 仅为排查"全量加载/未点击页面被请求"问题
//  打日志，不改任何行为；可安全保留。
//  前缀：
//    [DBG-FULL]   本页发生了"true full page load"（theme.boot 重跑）
//    [DBG-PJAX]   pjax 局部切换（对比 FULL 可判断是否走 PJAX）
//    [DBG-fetch]  我们的 JS 发起的 .html 请求（含调用栈）
//    [DBG-node]    动态注入的 script/link
//  关键判据：Network 面板出现 .html 请求、但这里没有对应 [DBG-fetch]
//           栈 → 说明是浏览器侧(预取/预渲染)或非包装代码发起的。
// ============================================================
(function () {
  'use strict';
  function log() { try { console.log('[DBG]', ...arguments); } catch (e) {} }

  // 1) 整页加载标记：本文件随整页 HTML 一起作为 classic script 载入，
  //    每次"真整页加载"都会执行到这里；PJAX 切换不会。
  log('FULLLOAD theme.boot + body 已执行 —— 这是一次【整页加载】', location.pathname);

  // 2) 拦截 window.fetch 中对 .html 的请求，带调用栈找出是谁发的
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || (input && String(input));
        if (typeof url === 'string' && /\.html(\?|$)/.test(url)) {
          const stack = new Error().stack.split('\n').slice(1, 4).map(s => s.trim()).join(' ⏎ ');
          log('fetch→', url, '| 调用方:', stack);
        }
      } catch (e) {}
      return origFetch(input, init);
    };
  } catch (e) {}

  // 3) XHR 中对 .html 的请求
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (typeof url === 'string' && /\.html(\?|$)/.test(url)) {
          const stack = new Error().stack.split('\n').slice(1, 4).map(s => s.trim()).join(' ⏎ ');
          log('xhr→', method, url, '| 调用方:', stack);
        }
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  } catch (e) {}

  // 4) 动态注入的 <script>/<link>（若指向 .html 需警惕）
  try {
    document.addEventListener('DOMContentLoaded', function () {
      const obs = new MutationObserver(function (muts) {
        for (const m of muts) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const n = m.addedNodes[i];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === 'SCRIPT') {
              const s = n.getAttribute('src');
              if (s && /\.html/.test(s)) log('注入<script>→', s);
            } else if (n.tagName === 'LINK') {
              const h = n.getAttribute('href');
              if (h && /\.html/.test(h)) log('注入<link rel=' + n.getAttribute('rel') + '>→', h);
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  } catch (e) {}

  // 暴露调试开关：window.__pjaxDebug
  window.__pjaxDebug = { enabled: true };
})();