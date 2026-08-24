async function wrapCurrentResult() {
  const current = String(state.lastResult || '').trim();
  if (!current) {
    setStatus(T.statusNoResult, true);
    return;
  }

  const wrapped = wrapWithCodeFence(current);
  setResult(wrapped);
  const copied = await copyText(wrapped);
  setStatus(copied ? T.statusWrapped : T.statusCopyFailed, !copied);
}

function formatTime(time) {
  try {
    return new Date(time).toLocaleString('zh-CN', { hour12: false });
  } catch (error) {
    return String(time);
  }
}

function renderHistory() {
  if (!ui.historyList) return;

  if (!state.history.length) {
    ui.historyList.innerHTML = `<div class="nai-history-empty">${T.noHistory}</div>`;
    return;
  }

  ui.historyList.innerHTML = state.history.map((item) => {
    const source = escapeHtml(item.sourceUrl || '\u672a\u77e5\u6765\u6e90');
    const result = escapeHtml(item.result || '');
    const brief = result.length > 140 ? `${result.slice(0, 140)}...` : result;

    return `
      <article class="nai-history-item" data-id="${item.id}">
        <div class="nai-history-meta"><span>${formatTime(item.time)}</span></div>
        <div class="nai-history-source" title="${source}">${source}</div>
        <div class="nai-history-brief">${brief}</div>
        <div class="nai-history-actions">
          <button type="button" data-action="history-copy" data-id="${item.id}">${T.copy}</button>
          <button type="button" data-action="history-use" data-id="${item.id}">${T.load}</button>
        </div>
      </article>
    `;
  }).join('');
}

async function saveHistory() {
  await storageSet({ [HISTORY_KEY]: state.history.slice(0, MAX_HISTORY) });
}

async function pushHistory(record) {
  state.history.unshift(record);
  state.history = state.history.slice(0, MAX_HISTORY);
  renderHistory();
  await saveHistory();
}

// 面板上只有一个主按钮：空闲时是「反推」，请求在途时是「取消」。
async function cancelCurrentRun() {
  const runId = state.cancellableRunId;
  if (!runId) return;

  state.cancellableRunId = null;
  setStatus(T.statusCancelling, false);

  try {
    await sendRuntimeMessage({ type: 'nai-llm-cancel', runId });
  } catch (error) {
    // 后台已经不在了也无所谓，请求本来就结束了。
  }
}

// NAI 原图把提示词写在 PNG 文本块或 alpha 隐写里，读到了就不必再问模型 ——
// 零成本、不上传、逐字准确。读不到就照常往下走。
function formatNaiMetadataResult(metadata) {
  const lines = [metadata.prompt];
  metadata.characterPrompts.forEach((character, index) => {
    lines.push('', `${character.label || `Character ${index + 1}`}: ${character.prompt}`);
  });
  if (metadata.negativePrompt) lines.push('', `Undesired Content: ${metadata.negativePrompt}`);
  return lines.join('\n');
}

async function useNaiMetadataResult(metadata) {
  const resultText = formatResultBySettings(formatNaiMetadataResult(metadata));
  setResult(resultText);

  await pushHistory({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: Date.now(),
    sourceUrl: state.selectedImage.sourceUrl,
    result: resultText,
  });

  const copied = await copyText(resultText);
  const summary = metadata.summary ? `（${metadata.summary}）` : '';
  setStatus(`${T.statusNaiMetadata}${summary}${copied ? '' : ' · 复制失败，请手动复制'}`, !copied);
}

async function reverseAndCopy() {
  if (state.pending) return;

  if (!state.selectedImage) {
    setStatus(T.statusNeedImage, true);
    return;
  }

  if (state.settings.preferNaiMetadata !== false && state.selectedImage.naiMetadata?.prompt) {
    await useNaiMetadataResult(state.selectedImage.naiMetadata);
    return;
  }

  if (!state.settings.apiKey?.trim()) {
    setStatus(T.statusNeedKey, true);
    openSettingsSurface();
    return;
  }

  const resolvedBlocks = getPromptConfig();
  if (!resolvedBlocks.length || !resolvedBlocks.some((b) => b.role === 'user')) {
    setStatus(T.statusNeedPrompt, true);
    openSettingsSurface();
    return;
  }

  if (!state.settings.rolePrompt?.trim()) {
    const preset = getActivePreset();
    const hasRoleVar = preset.blocks.some((b) => b.enabled && b.content.includes('{{role_prompt}}'));
    if (hasRoleVar) {
      setStatus(T.statusNeedRolePrompt, true);
      openSettingsSurface();
      return;
    }
  }

  const messages = buildMessages(resolvedBlocks);
  const primaryConfig = buildPrimaryConfig(messages);

  if (!hasCompleteModelConfig(primaryConfig)) {
    setStatus('\u8bf7\u5148\u5b8c\u6574\u914d\u7f6e\u4e3b\u6a21\u578b\u7684\u670d\u52a1\u5546\u3001Endpoint\u3001Model \u548c API Key\u3002', true);
    openSettingsSurface();
    return;
  }

  let fallbackConfig = null;
  if (state.settings.enableFallbackModel) {
    const candidate = buildFallbackConfig(messages);
    if (hasCompleteModelConfig(candidate)) {
      fallbackConfig = candidate;
    }
  }

  const runId = createId('llm-run');
  setPending(true, '\u53cd\u63a8\u4e2d...', { runId });
  setStatus(T.statusRunning, false);

  try {
    const response = await sendRuntimeMessage({
      type: 'nai-llm-chat',
      runId,
      payload: {
        primary: primaryConfig,
        fallback: fallbackConfig,
      },
    });

    if (response?.errorKind === 'aborted') {
      setStatus(T.statusCancelled, false);
      return;
    }

    if (!response?.ok) {
      throw new Error(response?.error || '\u53cd\u63a8\u5931\u8d25');
    }

    const usedFallback = Boolean(response.usedFallback);

    const modelResult = (response.text || '').trim() || '\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u6587\u672c\u7ed3\u679c\u3002';
    const resultText = formatResultBySettings(modelResult);
    setResult(resultText);

    await pushHistory({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      time: Date.now(),
      sourceUrl: state.selectedImage.sourceUrl,
      result: resultText,
    });

    const copied = await copyText(resultText);
    if (usedFallback) {
      setStatus(copied ? T.statusDoneCopiedFallback : T.statusDoneNotCopiedFallback, !copied);
    } else {
      setStatus(copied ? T.statusDoneCopied : T.statusDoneNotCopied, !copied);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setPending(false);
  }
}


