<script setup>
import { ref, watch, nextTick } from 'vue';

// 用 iframe(srcdoc) 隔离渲染邮件 HTML，彻底阻断邮件样式泄漏到应用 UI。
// content 应为完整 HTML 文档（由 buildEmailDocument 生成）。
const props = defineProps({
  content: { type: String, default: '' },
});
const frameEl = ref(null);
const frameHeight = ref(400);

function resize() {
  const el = frameEl.value;
  if (!el) return;
  const doc = el.contentDocument;
  if (!doc || !doc.body) return;
  const height = doc.body.scrollHeight || doc.documentElement.scrollHeight || 400;
  frameHeight.value = Math.max(200, Math.min(height + 16, 6000));
  // iframe 内部禁滚动，高度跟随内容撑开；过长上限 6000，由外层容器滚动
  doc.documentElement.style.overflow = 'hidden';
  el.style.height = '0px';
  el.style.height = frameHeight.value + 'px';
}

function onLoad() {
  try { resize(); } catch (e) { /* 跨域忽略 */ }
}

watch(() => props.content, async () => {
  frameHeight.value = 400;
  await nextTick();
  onLoad();
}, { immediate: true });
</script>

<template>
  <div class="mail-body w-full">
    <iframe
      v-if="content"
      ref="frameEl"
      class="w-full block border-0"
      :style="{ height: frameHeight + 'px' }"
      :srcdoc="content"
      sandbox="allow-same-origin"
      @load="onLoad"
    ></iframe>
    <p v-else class="text-faint text-sm py-4">（无内容）</p>
  </div>
</template>