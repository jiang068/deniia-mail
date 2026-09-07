<script setup>
import { computed } from 'vue';
import {
  remoteContentLevel,
  hasExternalImagesOf,
  hasAdvancedTrackersOf,
} from '../stores/mail.js';

const props = defineProps({
  content: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const hasExternalImages = computed(() => hasExternalImagesOf(props.content));
const hasAdvancedTrackers = computed(() => hasAdvancedTrackersOf(props.content));

function setLevel(level) {
  remoteContentLevel.value = level;
}
</script>

<template>
  <div class="mb-4 p-3 rounded-lg text-xs flex flex-wrap items-center justify-between gap-3 border border-line">
    <template v-if="remoteContentLevel === 0">
      <div class="flex-1 min-w-[200px] flex items-center gap-1.5 text-warn">
        <i data-lucide="shield-alert" class="w-4 h-4 shrink-0"></i>
        <span v-if="loading">正在加载并检查远程内容……</span>
        <span v-else-if="hasExternalImages || hasAdvancedTrackers">此邮件包含远程内容（图片及可能的追踪器），已全部拦截，未泄露阅读状态。</span>
        <span v-else>此邮件已按最安全方式显示。</span>
      </div>
      <div class="flex gap-2 shrink-0">
        <button @click="setLevel(1)" :disabled="loading"
          class="px-2.5 py-1 bg-accent text-accent-ink rounded-md font-medium disabled:opacity-50">只加载图片</button>
        <button @click="setLevel(2)" :disabled="loading"
          class="px-2.5 py-1 bg-danger danger-ink rounded-md font-medium disabled:opacity-50">加载全部</button>
      </div>
    </template>
    <template v-else>
      <div class="flex-1 min-w-[200px] flex items-center gap-1.5"
        :class="remoteContentLevel === 1 ? 'text-blue' : 'text-danger'">
        <i data-lucide="feather" class="w-4 h-4 shrink-0"></i>
        <span v-if="remoteContentLevel === 1">已只加载图片外链。<span v-if="hasAdvancedTrackers">其余追踪资源（CSS/媒体/预加载）仍被拦截。</span></span>
        <span v-else>已加载全部远程内容，可能泄露 IP 和阅读状态。</span>
      </div>
      <button @click="setLevel(0)"
        class="px-2.5 py-1 bg-surface2 text-sub border border-line rounded-md font-medium shrink-0">恢复拦截</button>
    </template>
  </div>
</template>
