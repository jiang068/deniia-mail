<script setup>
import { defaultDomain } from '../stores/mail.js';
import {
  dialogOpen, dialogError, dialogQuotaText, customName,
  closeMailboxDialog, createRandom, createCustom, showError,
} from '../composables/useMailboxDialog.js';
import { onMounted, onUnmounted } from 'vue';

function onModalClick(e) {
  const act = e.target?.closest?.('[data-act]')?.getAttribute('data-act');
  if (act === 'close') closeMailboxDialog();
  else if (act === 'random') createRandom();
  else if (act === 'custom') createCustom();
}
function onKeydown(e) { if (e.key === 'Escape') closeMailboxDialog(); }

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="dialogOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4"
         style="background: rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);"
         @mousedown.self="closeMailboxDialog" @click="onModalClick">
      <div class="bg-surface rounded-xl shadow-panel w-full max-w-md p-6 space-y-5 border border-line">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-main text-base">新建邮箱</h3>
          <button type="button" data-act="close" class="text-faint hover:text-text-main"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        <div class="text-xs text-sub">已用 <span class="font-medium text-main">{{ dialogQuotaText }}</span> 个</div>

        <button type="button" data-act="random"
          class="w-full text-left p-4 border border-line rounded-xl hover:border-accent hover:bg-accent-soft transition flex items-center space-x-3">
          <div class="p-2 bg-accent-soft text-accent rounded-lg"><i data-lucide="shuffle" class="w-5 h-5"></i></div>
          <div><p class="text-sm font-medium text-main">随机生成</p><p class="text-xs text-sub">例如 <span>3f9k2a@{{ defaultDomain }}</span></p></div>
        </button>

        <div class="border border-line rounded-xl p-4 space-y-3">
          <div class="flex items-center space-x-3">
            <div class="p-2 bg-accent-soft text-accent rounded-lg"><i data-lucide="pencil" class="w-5 h-5"></i></div>
            <p class="text-sm font-medium text-main">自定义名称</p>
          </div>
          <div class="flex items-center space-x-2">
            <input type="text" v-model="customName" placeholder="名称"
              class="flex-1 bg-surface2 text-main border border-line rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 ring-accent focus:outline-none">
            <span class="text-sm text-faint font-mono">@<span>{{ defaultDomain }}</span></span>
          </div>
          <button type="button" data-act="custom" class="w-full py-2 bg-accent hover-bg-accent-h text-accent-ink rounded-lg text-sm font-medium">创建</button>
          <p v-if="dialogError" class="text-xs text-danger">{{ dialogError }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>