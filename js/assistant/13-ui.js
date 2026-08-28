function createUI() {
  const root = document.createElement('div');
  root.className = 'nai-md3-root';
  root.innerHTML = `
    <button class="nai-md3-fab" type="button" title="${T.title}">${T.fab}</button>
    <section class="nai-md3-panel nai-hidden">
      <header class="nai-md3-header">
        <div class="nai-md3-title">${T.title}</div>
        <button class="nai-md3-close" type="button" data-action="close">&times;</button>
      </header>

      <!-- 顺序 = 用词的流程：读图出词 → 生成 → 编辑 → 找素材，然后才是记录和配置。
           原来第一个是「词库」，但它在面板里永远显示不出来（非 NAI 页被 CSS 藏掉，
           NAI 页整个面板都是隐藏的），点了也只会被 setPage 弹回「反推」。
           词库的入口在工作台侧栏，这里删掉。 -->
      <nav class="nai-md3-tabs">
        <button type="button" class="active" data-page="reverse">${T.tabReverse}</button>
        <button type="button" data-page="agent">${T.tabAgent}</button>
        <button type="button" data-page="flow">${T.tabFlow}</button>
        <button type="button" data-page="artists">${T.tabArtistsShort}</button>
        <button type="button" data-page="history">${T.tabHistory}</button>
        <button type="button" data-page="settings">${T.tabSettings}</button>
      </nav>

      <!-- 全局状态条：写词 / 设置页的反馈也要看得见，不能只挂在反推页里。
           空了就 display:none，不占高度（工作台那条同款）。 -->
      <div class="nai-md3-status"></div>

      <div class="nai-md3-body">
      <section class="nai-md3-page" data-page="reverse">
        <div class="nai-md3-hint">${T.quickHint}<kbd>Alt</kbd> + <kbd>Shift</kbd> + \u70b9\u51fb\u56fe\u7247</div>
        <div class="nai-md3-actions nai-md3-actions-reverse">
          <button type="button" data-action="pick">${T.pick}</button>
          <button type="button" data-action="open-image">${T.openImageFile}</button>
          <button type="button" class="nai-md3-primary" data-action="reverse">${T.reverseCopy}</button>
          <button type="button" data-action="copy">${T.copyResult}</button>
          <button type="button" data-action="wrap-code">${T.wrapCodeButton}</button>
          <button type="button" data-action="send-flow">${T.sendToFlow}</button>
        </div>
        <img class="nai-md3-preview nai-hidden" alt="preview" />
        <div class="nai-md3-preview-hint">${T.previewEmpty}</div>
        <label class="nai-md3-label">${T.resultLabel}</label>
        <textarea class="nai-md3-result" rows="8" readonly placeholder="${T.resultPlaceholder}"></textarea>
      </section>

      <section class="nai-md3-page nai-hidden" data-page="agent">
        ${agentMarkup()}
      </section>

      <section class="nai-md3-page nai-hidden" data-page="flow">
        ${flowHostMarkup()}
      </section>

      <section class="nai-md3-page nai-hidden" data-page="artists">
        ${artistQuickMarkup()}
      </section>

      <section class="nai-md3-page nai-hidden" data-page="history">
        <div class="nai-md3-actions"><button type="button" data-action="clear-history">${T.clearHistory}</button></div>
        <div class="nai-history-list"></div>
      </section>

      <!-- 设置页顺序 = 用户实际配置的顺序：
           不配就用不了的（模型服务）在最前，纯个性化的（外观）在最后。
           几处原来隔着一整段的东西也归了位：
             · 「启用备用模型」原来在生成选项末尾，控制的却是下一段的显隐 → 挪进备用模型段的段首
             · 备用模型的思考强度原来和主模型的挤在一起 → 跟着它的模型走
             · 备用模型段原来隔着生成选项和发送与输出 → 紧跟主模型，两段模型配置排在一起
             · 悬浮球说明和玻璃说明原来都堆在外观段末尾 → 各自贴着自己那组
             · 玻璃开关原来夹在三个悬浮球开关里，和强度滑块隔开 → 两者相邻
           模型服务那几项一律占整行，不并排两半：面板半宽的下拉只剩约 150px 可写字，
           「OpenAI Chat Completions」（169px）和「Google Vertex AI (OpenAI兼容)」（199px）
           都会被截断，模型名同理。抽屉那边足够宽，仍然是两列。 -->
      <section class="nai-md3-page nai-hidden" data-page="settings">
        <div class="nai-md3-settings-section">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionProvider}</div>
            <div class="nai-md3-section-note">${T.sectionProviderHint}</div>
          </div>
          <label class="nai-md3-label">${T.serviceProvider}</label><select class="nai-md3-input" data-field="providerPreset"></select>
          <label class="nai-md3-label">${T.protocol}</label><select class="nai-md3-input" data-field="protocol"></select>
          <label class="nai-md3-label">API Endpoint</label><input class="nai-md3-input" data-field="endpoint" type="text" />
          <div class="nai-md3-config-warn nai-hidden" data-field="endpointWarn"></div>
          <!-- 模型和 API Key 各占整行：并排两半时模型名（deepseek-reasoner 一类）
               被「获取模型」挤到只剩一截，看不出选的是哪个 -->
          <label class="nai-md3-label">${T.model}</label>
          <div class="nai-md3-input-row">
            <input class="nai-md3-input" data-field="model" list="nai-primary-model-list" type="text" />
            <button type="button" class="nai-md3-inline-action" data-action="fetch-models">${T.fetchModels}</button>
          </div>
          <datalist id="nai-primary-model-list"></datalist>
          <div class="nai-model-chips" data-field="modelChips" data-kind="primary"></div>
          <label class="nai-md3-label">API Key<button type="button" class="nai-md3-help" data-action="toggle-key-help" aria-label="如何获取">i</button></label>
          <input class="nai-md3-input" data-field="apiKey" type="password" />
          <div class="nai-md3-help-note nai-hidden" data-field="keyHelp"></div>
        </div>

        <div class="nai-md3-settings-section">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionFallback}</div>
            <div class="nai-md3-section-note">${T.sectionFallbackHint}</div>
          </div>
          <label class="nai-md3-switch"><input data-field="enableFallbackModel" type="checkbox" /><span>${T.fallbackMode}</span></label>
          <!-- 只藏字段，不藏上面那个开关 —— 否则关掉之后就再也打不开了 -->
          <div class="nai-md3-fallback-fields nai-hidden" data-fallback-section>
            <label class="nai-md3-label">${T.fallbackProvider}</label><select class="nai-md3-input" data-field="fallbackProviderPreset"></select>
            <label class="nai-md3-label">${T.fallbackProtocol}</label><select class="nai-md3-input" data-field="fallbackProtocol"></select>
            <label class="nai-md3-label">${T.fallbackEndpoint}</label><input class="nai-md3-input" data-field="fallbackEndpoint" type="text" />
            <div class="nai-md3-config-warn nai-hidden" data-field="fallbackEndpointWarn"></div>
            <label class="nai-md3-label">${T.fallbackModel}</label>
            <div class="nai-md3-input-row">
              <input class="nai-md3-input" data-field="fallbackModel" list="nai-fallback-model-list" type="text" />
              <button type="button" class="nai-md3-inline-action" data-action="fetch-fallback-models">${T.fetchModels}</button>
            </div>
            <datalist id="nai-fallback-model-list"></datalist>
            <div class="nai-model-chips" data-field="fallbackModelChips" data-kind="fallback"></div>
            <label class="nai-md3-label">${T.fallbackApiKey}</label><input class="nai-md3-input" data-field="fallbackApiKey" type="password" />
            <label class="nai-md3-label">${T.fallbackReasoningEffort}</label><select class="nai-md3-input" data-field="fallbackReasoningEffort"></select>
          </div>
        </div>

        <div class="nai-md3-settings-section">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionSampling}</div>
            <div class="nai-md3-section-note">${T.sectionSamplingHint}</div>
          </div>
          <div class="nai-md3-grid-2">
            <div><label class="nai-md3-label">Temperature</label><input class="nai-md3-input" data-field="temperature" type="number" min="0" max="2" step="0.1" /></div>
            <div><label class="nai-md3-label">Max Tokens</label><input class="nai-md3-input" data-field="maxTokens" type="number" min="64" max="32000" step="1" /></div>
          </div>
          <label class="nai-md3-label">${T.reasoningEffort}</label><select class="nai-md3-input" data-field="reasoningEffort"></select>
          <div class="nai-md3-section-note">${T.reasoningHint}</div>
        </div>

        <div class="nai-md3-settings-section">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionBehavior}</div>
            <div class="nai-md3-section-note">${T.sectionBehaviorHint}</div>
          </div>
          <div class="nai-md3-switch-stack">
            <label class="nai-md3-switch"><input data-field="preferNaiMetadata" type="checkbox" /><span>${T.preferNaiMetadata}</span></label>
            <label class="nai-md3-switch"><input data-field="allowDanbooruLookup" type="checkbox" /><span>${T.allowDanbooruLookup}</span></label>
            <label class="nai-md3-switch"><input data-field="agentNai5Rules" type="checkbox" /><span>${T.agentNai5Rules}</span></label>
            <label class="nai-md3-switch"><input data-field="sendImageAsDataUrl" type="checkbox" /><span>${T.sendImageAsDataUrl}</span></label>
            <label class="nai-md3-switch"><input data-field="enableBooruTagContext" type="checkbox" /><span>${T.enableBooruTagContext}</span></label>
          </div>
          <div class="nai-booru-tag-types nai-hidden" data-booru-tag-types>
            <label class="nai-md3-check-inline"><input type="checkbox" data-booru-type="artist" /><span>artist</span></label>
            <label class="nai-md3-check-inline"><input type="checkbox" data-booru-type="character" /><span>character</span></label>
            <label class="nai-md3-check-inline"><input type="checkbox" data-booru-type="copyright" /><span>copyright</span></label>
            <label class="nai-md3-check-inline"><input type="checkbox" data-booru-type="general" /><span>general</span></label>
            <label class="nai-md3-check-inline"><input type="checkbox" data-booru-type="meta" /><span>meta</span></label>
          </div>
          <label class="nai-md3-switch"><input data-field="defaultCodeFence" type="checkbox" /><span>${T.defaultCodeFence}</span></label>
          <div class="nai-md3-section-note">${T.preferNaiMetadataHint}</div>
          <div class="nai-md3-section-note">${T.allowDanbooruLookupHint}</div>
          <div class="nai-md3-section-note">${T.agentNai5RulesHint}</div>
        </div>

        <div class="nai-md3-settings-section">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionPrompt}</div>
            <div class="nai-md3-section-note">${T.sectionPromptHint}</div>
          </div>
          <label class="nai-md3-label">${T.naiDialectLabel}</label><select class="nai-md3-input" data-field="naiDialect"></select>
          <div class="nai-md3-section-note">${T.naiDialectHint}</div>
          <div class="nai-md3-grid-2" style="align-items:end">
            <div><label class="nai-md3-label">预设</label><select class="nai-md3-input" data-field="activePresetId"></select></div>
            <div style="display:flex;gap:.4em;padding-bottom:2px;flex-wrap:wrap"><button type="button" class="nai-md3-inline-action" data-action="duplicate-preset">复制</button><button type="button" class="nai-md3-inline-action" data-action="new-preset">新建</button><button type="button" class="nai-md3-inline-action" data-import-open="preset">${T.importStPreset}</button><button type="button" class="nai-md3-inline-action nai-preset-delete-btn nai-hidden" data-action="delete-preset">删除</button><button type="button" class="nai-md3-inline-action nai-preset-reset-btn nai-hidden" data-action="reset-preset">恢复默认</button></div>
          </div>
          <label class="nai-md3-label">预设名称</label><input class="nai-md3-input" data-field="activePresetName" type="text" placeholder="自定义预设名称" />
          ${importBoxMarkup('preset')}
          <div class="nai-preset-role-section nai-hidden">
            <label class="nai-md3-label">${T.rolePrompt}</label><textarea class="nai-md3-input" data-field="rolePrompt" rows="2"></textarea>
            <div class="nai-md3-grid-2 nai-md3-library-row">
              <div><label class="nai-md3-label">${T.roleLibrary}</label><select class="nai-md3-input" data-field="roleLibrarySelect"></select></div>
              <div class="nai-md3-library-action"><button type="button" class="nai-md3-inline-action" data-action="apply-role-library">${T.applyRoleLibrary}</button></div>
            </div>
          </div>
          <div class="nai-preset-blocks-editor" data-preset-blocks></div>
          <div style="display:flex;gap:.5em;margin-top:.4em;flex-wrap:wrap">
            <button type="button" class="nai-md3-inline-action" data-action="add-block">+ 添加消息块</button>
            <span class="nai-preset-var-chips"><button type="button" class="nai-preset-var-chip" data-action="insert-variable" data-variable="{{booru_tags}}">{{booru_tags}}</button><button type="button" class="nai-preset-var-chip" data-action="insert-variable" data-variable="{{role_prompt}}">{{role_prompt}}</button></span>
          </div>
        </div>

        <div class="nai-md3-settings-section nai-md3-settings-appearance">
          <div class="nai-md3-section-head">
            <div class="nai-md3-section-title">${T.sectionAppearance}</div>
            <div class="nai-md3-section-note">${T.sectionAppearanceHint}</div>
          </div>
          <div><label class="nai-md3-label">${T.themePreset}</label><select class="nai-md3-input" data-field="themePreset"></select></div>
          <div class="nai-md3-switch-stack">
            <label class="nai-md3-switch"><input data-field="showReverseFloatingBall" type="checkbox" /><span>${T.showReverseEntry}</span></label>
            <label class="nai-md3-switch"><input data-field="showWorkbenchFloatingBall" type="checkbox" /><span>${T.showWorkbenchEntry}</span></label>
            <label class="nai-md3-switch"><input data-field="showExternalFloatingBall" type="checkbox" /><span>${T.showExternalEntry}</span></label>
          </div>
          <div class="nai-md3-section-note">${T.showExternalEntryHint}</div>
          <label class="nai-md3-switch"><input data-field="glassEffect" type="checkbox" /><span>${T.glassEffect}</span></label>
          <div class="nai-md3-slider-row">
            <span class="nai-md3-slider-label">${T.glassStrength}</span>
            <input class="nai-md3-slider" data-field="glassStrength" type="range" min="0" max="100" step="5" />
            <span class="nai-md3-slider-value" data-field="glassStrengthValue">100%</span>
          </div>
          <div class="nai-md3-section-note">${T.glassEffectHint}</div>
        </div>

        <div class="nai-md3-actions nai-md3-settings-actions"><button type="button" data-action="test-connection">${T.testConnection}</button><button type="button" class="nai-md3-primary" data-action="save-settings">${T.saveSettings}</button></div>
      </section>
      </div>
      <div class="nai-md3-resize-handle" aria-hidden="true"></div>
    </section>
    <aside class="nai-library-drawer nai-hidden" aria-label="工作台">
      <div class="nai-library-drawer-resize-handle" role="separator" aria-orientation="vertical" aria-label="拖拽调整宽度（双击重置）" title="拖拽调整宽度 · 双击重置"></div>
      <div class="nai-library-drawer-surface">
        <header class="nai-library-drawer-head">
          <div>
            <div class="nai-library-drawer-kicker">NAI Autocomplete</div>
            <div class="nai-library-drawer-title">工作台</div>
          </div>
          <button class="nai-library-drawer-close" type="button" data-action="close-drawer" aria-label="关闭工作台">×</button>
        </header>

        <div class="nai-library-drawer-status"></div>

        <div class="nai-library-drawer-content">
          <nav class="nai-workbench-sidebar" aria-label="工作台窗口">
            <div class="nai-workbench-nav-main">
              <button type="button" class="nai-workbench-nav-item is-active" data-workbench-page="library" data-action="workbench-open-library" title="词库">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('library')}</span>
                <span class="nai-workbench-nav-text">${T.tabLibrary}</span>
              </button>
              <button type="button" class="nai-workbench-nav-item" data-workbench-page="agent" data-action="workbench-open-agent" title="写词">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('agent')}</span>
                <span class="nai-workbench-nav-text">${T.tabAgent}</span>
              </button>
              <button type="button" class="nai-workbench-nav-item" data-workbench-page="flow" data-action="workbench-open-flow" title="改词">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('flow')}</span>
                <span class="nai-workbench-nav-text">${T.tabFlow}</span>
              </button>
              <button type="button" class="nai-workbench-nav-item" data-workbench-page="artists" data-action="workbench-open-artists" title="画师库">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('artists')}</span>
                <span class="nai-workbench-nav-text">${T.tabArtists}</span>
              </button>
              <button type="button" class="nai-workbench-nav-item" data-workbench-page="presets" data-action="workbench-open-presets" title="预设">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('presets')}</span>
                <span class="nai-workbench-nav-text">预设</span>
              </button>
              <button type="button" class="nai-workbench-nav-item" data-workbench-page="settings" data-action="workbench-open-settings" title="设置">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('settings')}</span>
                <span class="nai-workbench-nav-text">设置</span>
              </button>
            </div>
            <div class="nai-workbench-nav-bottom">
              <button type="button" class="nai-workbench-nav-item is-collapse" data-action="workbench-toggle-sidebar" aria-expanded="true" title="收起侧边栏">
                <span class="nai-workbench-nav-icon" aria-hidden="true">${getWorkbenchIcon('collapse')}</span>
                <span class="nai-workbench-nav-text">收起</span>
              </button>
            </div>
          </nav>

          <section class="nai-library-editor" aria-label="词库编辑">
            <div class="nai-library-editor-head">
              <div>
                <div class="nai-library-editor-kicker">Prompt Chunk</div>
                <div class="nai-library-editor-title">词库编辑</div>
              </div>
              <button class="nai-library-editor-close" type="button" data-action="library-close-editor" aria-label="隐藏词库编辑">×</button>
            </div>
            <div class="nai-library-editor-row">
              <label class="nai-library-field">
                <span>分类</span>
                <select data-field="libraryCategory">
                  ${PROMPT_LIBRARY_CATEGORIES.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}
                </select>
              </label>
              <label class="nai-library-field">
                <span>名称</span>
                <input data-field="libraryName" type="text" placeholder="yuukarin" />
              </label>
            </div>
            <label class="nai-library-field nai-hidden" data-field="libraryAliasesField">
              <span>别名（写词时点名用，逗号分隔）</span>
              <input data-field="libraryAliases" type="text" placeholder="小夏, Natsuki" />
            </label>
            <label class="nai-library-field">
              <span>Prompt Chunk 内容</span>
              <textarea data-field="libraryPrompt" rows="8" placeholder="hair, eyes, outfit"></textarea>
            </label>
            <div class="nai-library-editor-actions">
              <button type="button" data-action="library-new">新建</button>
              <button type="button" class="is-primary" data-action="library-save-sync">保存并同步</button>
            </div>
          </section>

          <section class="nai-library-main" aria-label="工作台页面">
            <section class="nai-library-index" data-workbench-panel="library">
              <div class="nai-library-index-head">
                <div>已保存词库</div>
                <button type="button" data-action="library-new">新建</button>
              </div>
              <div class="nai-library-list"></div>
            </section>

            <section class="nai-library-presets" data-workbench-panel="presets">
              <div class="nai-library-page-head">
                <div>
                  <div class="nai-library-page-kicker">Workbench</div>
                  <div class="nai-library-page-title">提示词预设</div>
                </div>
              </div>
              <div class="nai-library-settings-stack">
                <div class="nai-library-settings-group">
                  <div style="display:flex;gap:.5em;align-items:end;flex-wrap:wrap">
                    <label class="nai-library-field" style="flex:1;min-width:120px">
                      <span>预设</span>
                      <select data-field="wbPresetId"></select>
                    </label>
                    <div style="display:flex;gap:.4em;padding-bottom:2px;flex-wrap:wrap">
                      <button type="button" class="nai-md3-inline-action" data-action="wb-duplicate-preset">复制</button>
                      <button type="button" class="nai-md3-inline-action" data-action="wb-new-preset">新建</button>
                      <button type="button" class="nai-md3-inline-action" data-import-open="preset">${T.importStPreset}</button>
                      <button type="button" class="nai-md3-inline-action nai-wb-preset-delete-btn nai-hidden" data-action="wb-delete-preset">删除</button>
                      <button type="button" class="nai-md3-inline-action nai-wb-preset-reset-btn nai-hidden" data-action="wb-reset-preset">恢复默认</button>
                    </div>
                  </div>
                  ${importBoxMarkup('preset')}
                  <label class="nai-library-field">
                    <span>预设名称</span>
                    <input data-field="wbPresetName" type="text" placeholder="自定义预设名称" />
                  </label>
                  <div class="nai-wb-preset-role-section nai-hidden">
                    <label class="nai-library-field">
                      <span>${T.rolePrompt}</span>
                      <textarea data-field="wbRolePrompt" rows="2"></textarea>
                    </label>
                    <div style="display:flex;gap:.5em;align-items:end">
                      <label class="nai-library-field" style="flex:1"><span>${T.roleLibrary}</span><select data-field="wbRoleLibrarySelect"></select></label>
                      <button type="button" class="nai-md3-inline-action" data-action="wb-apply-role-library" style="margin-bottom:2px">套用</button>
                    </div>
                  </div>
                  <div class="nai-preset-blocks-container" data-wb-preset-blocks></div>
                  <div style="display:flex;gap:.5em;margin-top:.4em;flex-wrap:wrap">
                    <button type="button" class="nai-md3-inline-action" data-action="wb-add-block">+ 添加消息块</button>
                    <span class="nai-preset-var-chips"><button type="button" class="nai-preset-var-chip" data-action="wb-insert-variable" data-variable="{{booru_tags}}">{{booru_tags}}</button><button type="button" class="nai-preset-var-chip" data-action="wb-insert-variable" data-variable="{{role_prompt}}">{{role_prompt}}</button></span>
                  </div>
                </div>
                <div class="nai-library-settings-group">
                  <button type="button" class="nai-md3-inline-action is-primary" data-action="wb-save-presets" style="align-self:flex-start">保存预设</button>
                </div>
              </div>
            </section>

            <section class="nai-library-agent" data-workbench-panel="agent">
              ${agentMarkup()}
            </section>

            <section class="nai-library-flow" data-workbench-panel="flow">
              ${flowHostMarkup()}
            </section>

            <section class="nai-library-artists" data-workbench-panel="artists">
              ${artistQuickMarkup()}
            </section>

            <section class="nai-library-settings" data-workbench-panel="settings">
              <div class="nai-library-page-head">
                <div>
                  <div class="nai-library-page-kicker">Workbench</div>
                  <div class="nai-library-page-title">工作台设置</div>
                </div>
              </div>
              <!-- 顺序和面板设置页一致：主模型 → 备用模型 → 生成参数 → 发送与输出 → 提示词 → 外观。
                   两边曾经各排各的（这边是外观打头），同一个设置在两个界面里位置对不上。
                   「启用备用模型」也从生成选项挪进了备用模型段的段首。
                   模型和 API Key 各占整行 —— 并排两半时模型名会被截断，看不出选的是哪个。 -->
              <div class="nai-library-settings-stack">
                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">主模型</div>
                  <div class="nai-library-settings-grid">
                    <label class="nai-library-field">
                      <span>${T.serviceProvider}</span>
                      <select data-field="libraryProviderPreset"></select>
                    </label>
                    <label class="nai-library-field">
                      <span>${T.protocol}</span>
                      <select data-field="libraryProtocol"></select>
                    </label>
                  </div>
                  <label class="nai-library-field">
                    <span>API Endpoint</span>
                    <input data-field="libraryEndpoint" type="text" />
                  </label>
                  <div class="nai-md3-config-warn nai-hidden" data-field="libraryEndpointWarn"></div>
                  <label class="nai-library-field">
                    <span>${T.model}</span>
                    <input data-field="libraryModel" list="nai-library-primary-model-list" type="text" />
                    <datalist id="nai-library-primary-model-list"></datalist>
                    <div class="nai-model-chips" data-field="libraryModelChips" data-kind="primary"></div>
                  </label>
                  <label class="nai-library-field">
                    <span>API Key</span>
                    <input data-field="libraryApiKey" type="password" />
                  </label>
                  <div class="nai-library-settings-actions">
                    <button type="button" data-action="library-fetch-models">${T.fetchModels}</button>
                    <button type="button" data-action="library-test-connection">${T.testConnection}</button>
                  </div>
                </div>

                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">备用模型</div>
                  <label class="nai-library-check">
                    <input data-field="libraryEnableFallbackModel" type="checkbox" />
                    <span>${T.fallbackMode}</span>
                  </label>
                  <div class="nai-library-settings-grid">
                    <label class="nai-library-field">
                      <span>${T.fallbackProvider}</span>
                      <select data-field="libraryFallbackProviderPreset"></select>
                    </label>
                    <label class="nai-library-field">
                      <span>${T.fallbackProtocol}</span>
                      <select data-field="libraryFallbackProtocol"></select>
                    </label>
                  </div>
                  <label class="nai-library-field">
                    <span>${T.fallbackEndpoint}</span>
                    <input data-field="libraryFallbackEndpoint" type="text" />
                  </label>
                  <div class="nai-md3-config-warn nai-hidden" data-field="libraryFallbackEndpointWarn"></div>
                  <label class="nai-library-field">
                    <span>${T.fallbackModel}</span>
                    <input data-field="libraryFallbackModel" list="nai-library-fallback-model-list" type="text" />
                    <datalist id="nai-library-fallback-model-list"></datalist>
                    <div class="nai-model-chips" data-field="libraryFallbackModelChips" data-kind="fallback"></div>
                  </label>
                  <label class="nai-library-field">
                    <span>${T.fallbackApiKey}</span>
                    <input data-field="libraryFallbackApiKey" type="password" />
                  </label>
                  <div class="nai-library-settings-actions">
                    <button type="button" data-action="library-fetch-fallback-models">${T.fetchModels}</button>
                  </div>
                </div>

                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">${T.sectionSampling}</div>
                  <div class="nai-library-settings-grid">
                    <label class="nai-library-field">
                      <span>Temperature</span>
                      <input data-field="libraryTemperature" type="number" min="0" max="2" step="0.1" />
                    </label>
                    <label class="nai-library-field">
                      <span>Max Tokens</span>
                      <input data-field="libraryMaxTokens" type="number" min="64" max="32000" step="1" />
                    </label>
                  </div>
                </div>

                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">${T.sectionBehavior}</div>
                  <label class="nai-library-check">
                    <input data-field="libraryPreferNaiMetadata" type="checkbox" />
                    <span>${T.preferNaiMetadata}</span>
                  </label>
                  <label class="nai-library-check">
                    <input data-field="libraryAllowDanbooruLookup" type="checkbox" />
                    <span>${T.allowDanbooruLookup}</span>
                  </label>
                  <label class="nai-library-check">
                    <input data-field="libraryAgentNai5Rules" type="checkbox" />
                    <span>${T.agentNai5Rules}</span>
                  </label>
                  <label class="nai-library-check">
                    <input data-field="librarySendImageAsDataUrl" type="checkbox" />
                    <span>${T.sendImageAsDataUrl}</span>
                  </label>
                  <label class="nai-library-check">
                    <input data-field="libraryEnableBooruTagContext" type="checkbox" />
                    <span>${T.enableBooruTagContext}</span>
                  </label>
                  <label class="nai-library-check">
                    <input data-field="libraryDefaultCodeFence" type="checkbox" />
                    <span>${T.defaultCodeFence}</span>
                  </label>
                </div>

                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">提示词</div>
                  <label class="nai-library-field">
                    <span>${T.naiDialectLabel}</span>
                    <select data-field="libraryNaiDialect"></select>
                  </label>
                  <label class="nai-library-field">
                    <span>预设</span>
                    <select data-field="libraryActivePresetId"></select>
                  </label>
                  <label class="nai-library-field">
                    <span>${T.rolePrompt}</span>
                    <textarea data-field="libraryRolePrompt" rows="2"></textarea>
                  </label>
                  <div class="nai-library-settings-grid">
                    <label class="nai-library-field">
                      <span>${T.roleLibrary}</span>
                      <select data-field="libraryRoleLibrarySelect"></select>
                    </label>
                    <div class="nai-library-settings-actions is-bottom">
                      <button type="button" data-action="library-apply-role-library">${T.applyRoleLibrary}</button>
                    </div>
                  </div>
                </div>

                <div class="nai-library-settings-group">
                  <div class="nai-library-settings-title">外观</div>
                  <div class="nai-library-settings-grid">
                    <label class="nai-library-field">
                      <span>颜色预设</span>
                      <select data-field="libraryThemePreset"></select>
                    </label>
                    <div class="nai-library-check-stack">
                      <label class="nai-library-check">
                        <input data-field="libraryShowReverseFloatingBall" type="checkbox" />
                        <span>${T.showReverseEntry}</span>
                      </label>
                      <label class="nai-library-check">
                        <input data-field="libraryShowWorkbenchFloatingBall" type="checkbox" />
                        <span>${T.showWorkbenchEntry}</span>
                      </label>
                      <label class="nai-library-check">
                        <input data-field="libraryShowExternalFloatingBall" type="checkbox" />
                        <span>${T.showExternalEntry}</span>
                      </label>
                      <label class="nai-library-check">
                        <input data-field="libraryGlassEffect" type="checkbox" />
                        <span>${T.glassEffect}</span>
                      </label>
                      <div class="nai-md3-slider-row">
                        <span class="nai-md3-slider-label">${T.glassStrength}</span>
                        <input class="nai-md3-slider" data-field="libraryGlassStrength" type="range" min="0" max="100" step="5" />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="nai-library-settings-save">
                  <button type="button" class="is-primary" data-action="library-save-settings">${T.saveSettings}</button>
                </div>
              </div>
            </section>
          </section>
        </div>
      </div>
    </aside>
  `;

  document.body.appendChild(root);
  ui.root = root;
  ui.fab = root.querySelector('.nai-md3-fab');
  ui.panel = root.querySelector('.nai-md3-panel');
  ui.library.drawer = root.querySelector('.nai-library-drawer');
  ui.library.resizeHandle = ui.library.drawer?.querySelector('.nai-library-drawer-resize-handle');
  ui.library.status = root.querySelector('.nai-library-drawer-status');
  ui.library.editor = root.querySelector('.nai-library-editor');
  ui.library.sidebarToggle = root.querySelector('[data-action="workbench-toggle-sidebar"]');
  ui.library.settingsPanel = root.querySelector('[data-workbench-panel="settings"]');
  ui.library.presetsPanel = root.querySelector('[data-workbench-panel="presets"]');
  ui.library.artistsPanel = root.querySelector('[data-workbench-panel="artists"]');
  bindArtistQuickEvents(root);
  ui.wb = {
    presetId: root.querySelector('[data-field="wbPresetId"]'),
    presetName: root.querySelector('[data-field="wbPresetName"]'),
    blocksContainer: root.querySelector('[data-wb-preset-blocks]'),
    deleteBtn: root.querySelector('.nai-wb-preset-delete-btn'),
    resetBtn: root.querySelector('.nai-wb-preset-reset-btn'),
    roleSection: root.querySelector('.nai-wb-preset-role-section'),
    rolePrompt: root.querySelector('[data-field="wbRolePrompt"]'),
    roleLibrarySelect: root.querySelector('[data-field="wbRoleLibrarySelect"]'),
  };
  ui.header = root.querySelector('.nai-md3-header');
  ui.resizeHandle = root.querySelector('.nai-md3-resize-handle');
  ui.status = root.querySelector('.nai-md3-status');
  ui.preview = root.querySelector('.nai-md3-preview');
  ui.previewHint = root.querySelector('.nai-md3-preview-hint');
  ui.resultOutput = root.querySelector('.nai-md3-result');
  ui.sendButton = root.querySelector('[data-action="reverse"]');
  ui.historyList = root.querySelector('.nai-history-list');
  ui.libraryList = root.querySelector('.nai-library-list');
  ui.navButtons = Array.from(root.querySelectorAll('.nai-md3-tabs [data-page]'));

  root.querySelectorAll('.nai-md3-page').forEach((el) => {
    ui.pages[el.dataset.page] = el;
  });

  ui.settings.providerPreset = root.querySelector('[data-field="providerPreset"]');
  ui.settings.protocol = root.querySelector('[data-field="protocol"]');
  ui.settings.themePreset = root.querySelector('[data-field="themePreset"]');
  ui.settings.endpoint = root.querySelector('[data-field="endpoint"]');
  ui.settings.endpointWarn = root.querySelector('[data-field="endpointWarn"]');
  ui.settings.fallbackEndpointWarn = root.querySelector('[data-field="fallbackEndpointWarn"]');
  ui.settings.model = root.querySelector('[data-field="model"]');
  ui.settings.modelList = root.querySelector('#nai-primary-model-list');
  ui.settings.apiKey = root.querySelector('[data-field="apiKey"]');
  ui.settings.activePresetId = root.querySelector('[data-field="activePresetId"]');
  ui.settings.presetName = root.querySelector('[data-field="activePresetName"]');
  ui.settings.roleSection = root.querySelector('.nai-preset-role-section');
  ui.settings.rolePrompt = root.querySelector('[data-field="rolePrompt"]');
  ui.settings.roleLibrarySelect = root.querySelector('[data-field="roleLibrarySelect"]');
  ui.settings.presetBlocksContainer = root.querySelector('[data-preset-blocks]');
  ui.settings.presetDeleteBtn = root.querySelector('.nai-preset-delete-btn');
  ui.settings.presetResetBtn = root.querySelector('.nai-preset-reset-btn');
  ui.settings.booruTagTypesSection = root.querySelector('[data-booru-tag-types]');
  ui.settings.temperature = root.querySelector('[data-field="temperature"]');
  ui.settings.maxTokens = root.querySelector('[data-field="maxTokens"]');
  ui.settings.reasoningEffort = root.querySelector('[data-field="reasoningEffort"]');
  ui.settings.fallbackReasoningEffort = root.querySelector('[data-field="fallbackReasoningEffort"]');
  ui.settings.keyHelp = root.querySelector('[data-field="keyHelp"]');
  ui.settings.enableFallbackModel = root.querySelector('[data-field="enableFallbackModel"]');
  ui.settings.fallbackProviderPreset = root.querySelector('[data-field="fallbackProviderPreset"]');
  ui.settings.fallbackProtocol = root.querySelector('[data-field="fallbackProtocol"]');
  ui.settings.fallbackEndpoint = root.querySelector('[data-field="fallbackEndpoint"]');
  ui.settings.fallbackModel = root.querySelector('[data-field="fallbackModel"]');
  ui.settings.fallbackModelList = root.querySelector('#nai-fallback-model-list');
  ui.settings.fallbackApiKey = root.querySelector('[data-field="fallbackApiKey"]');
  ui.settings.fallbackSection = root.querySelector('[data-fallback-section]');
  ui.settings.preferNaiMetadata = root.querySelector('[data-field="preferNaiMetadata"]');
  ui.settings.allowDanbooruLookup = root.querySelector('[data-field="allowDanbooruLookup"]');
  ui.settings.agentNai5Rules = root.querySelector('[data-field="agentNai5Rules"]');
  ui.settings.naiDialect = root.querySelector('[data-field="naiDialect"]');
  ui.settings.modelChips = root.querySelector('[data-field="modelChips"]');
  ui.settings.fallbackModelChips = root.querySelector('[data-field="fallbackModelChips"]');
  ui.settings.sendImageAsDataUrl = root.querySelector('[data-field="sendImageAsDataUrl"]');
  ui.settings.enableBooruTagContext = root.querySelector('[data-field="enableBooruTagContext"]');
  ui.settings.defaultCodeFence = root.querySelector('[data-field="defaultCodeFence"]');
  ui.settings.showReverseFloatingBall = root.querySelector('[data-field="showReverseFloatingBall"]');
  ui.settings.showWorkbenchFloatingBall = root.querySelector('[data-field="showWorkbenchFloatingBall"]');
  ui.settings.showExternalFloatingBall = root.querySelector('[data-field="showExternalFloatingBall"]');
  ui.settings.glassEffect = root.querySelector('[data-field="glassEffect"]');
  ui.settings.glassStrength = root.querySelector('[data-field="glassStrength"]');
  ui.settings.glassStrengthValue = root.querySelector('[data-field="glassStrengthValue"]');
  ui.library.category = ui.library.drawer?.querySelector('[data-field="libraryCategory"]');
  ui.library.name = ui.library.drawer?.querySelector('[data-field="libraryName"]');
  ui.library.aliases = ui.library.drawer?.querySelector('[data-field="libraryAliases"]');
  ui.library.aliasesField = ui.library.drawer?.querySelector('[data-field="libraryAliasesField"]');
  ui.library.prompt = ui.library.drawer?.querySelector('[data-field="libraryPrompt"]');
  ui.library.themePreset = ui.library.drawer?.querySelector('[data-field="libraryThemePreset"]');
  ui.library.showReverseFloatingBall = ui.library.drawer?.querySelector('[data-field="libraryShowReverseFloatingBall"]');
  ui.library.showWorkbenchFloatingBall = ui.library.drawer?.querySelector('[data-field="libraryShowWorkbenchFloatingBall"]');
  ui.library.showExternalFloatingBall = ui.library.drawer?.querySelector('[data-field="libraryShowExternalFloatingBall"]');
  ui.library.glassEffect = ui.library.drawer?.querySelector('[data-field="libraryGlassEffect"]');
  ui.library.glassStrength = ui.library.drawer?.querySelector('[data-field="libraryGlassStrength"]');
  ui.library.providerPreset = ui.library.drawer?.querySelector('[data-field="libraryProviderPreset"]');
  ui.library.protocol = ui.library.drawer?.querySelector('[data-field="libraryProtocol"]');
  ui.library.endpoint = ui.library.drawer?.querySelector('[data-field="libraryEndpoint"]');
  ui.library.endpointWarn = ui.library.drawer?.querySelector('[data-field="libraryEndpointWarn"]');
  ui.library.fallbackEndpointWarn = ui.library.drawer?.querySelector('[data-field="libraryFallbackEndpointWarn"]');
  ui.library.model = ui.library.drawer?.querySelector('[data-field="libraryModel"]');
  ui.library.modelList = ui.library.drawer?.querySelector('#nai-library-primary-model-list');
  ui.library.apiKey = ui.library.drawer?.querySelector('[data-field="libraryApiKey"]');
  ui.library.activePresetId = ui.library.drawer?.querySelector('[data-field="libraryActivePresetId"]');
  ui.library.rolePrompt = ui.library.drawer?.querySelector('[data-field="libraryRolePrompt"]');
  ui.library.roleLibrarySelect = ui.library.drawer?.querySelector('[data-field="libraryRoleLibrarySelect"]');
  ui.library.temperature = ui.library.drawer?.querySelector('[data-field="libraryTemperature"]');
  ui.library.maxTokens = ui.library.drawer?.querySelector('[data-field="libraryMaxTokens"]');
  ui.library.preferNaiMetadata = ui.library.drawer?.querySelector('[data-field="libraryPreferNaiMetadata"]');
  ui.library.allowDanbooruLookup = ui.library.drawer?.querySelector('[data-field="libraryAllowDanbooruLookup"]');
  ui.library.agentNai5Rules = ui.library.drawer?.querySelector('[data-field="libraryAgentNai5Rules"]');
  ui.library.naiDialect = ui.library.drawer?.querySelector('[data-field="libraryNaiDialect"]');
  ui.library.modelChips = ui.library.drawer?.querySelector('[data-field="libraryModelChips"]');
  ui.library.fallbackModelChips = ui.library.drawer?.querySelector('[data-field="libraryFallbackModelChips"]');
  ui.library.sendImageAsDataUrl = ui.library.drawer?.querySelector('[data-field="librarySendImageAsDataUrl"]');
  ui.library.enableBooruTagContext = ui.library.drawer?.querySelector('[data-field="libraryEnableBooruTagContext"]');
  ui.library.defaultCodeFence = ui.library.drawer?.querySelector('[data-field="libraryDefaultCodeFence"]');
  ui.library.enableFallbackModel = ui.library.drawer?.querySelector('[data-field="libraryEnableFallbackModel"]');
  ui.library.fallbackProviderPreset = ui.library.drawer?.querySelector('[data-field="libraryFallbackProviderPreset"]');
  ui.library.fallbackProtocol = ui.library.drawer?.querySelector('[data-field="libraryFallbackProtocol"]');
  ui.library.fallbackEndpoint = ui.library.drawer?.querySelector('[data-field="libraryFallbackEndpoint"]');
  ui.library.fallbackModel = ui.library.drawer?.querySelector('[data-field="libraryFallbackModel"]');
  ui.library.fallbackModelList = ui.library.drawer?.querySelector('#nai-library-fallback-model-list');
  ui.library.fallbackApiKey = ui.library.drawer?.querySelector('[data-field="libraryFallbackApiKey"]');

  fillSelectOptions(ui.settings.providerPreset, PROVIDER_PRESETS);
  fillSelectOptions(ui.settings.protocol, PROTOCOL_OPTIONS);
  fillSelectOptions(ui.settings.reasoningEffort, REASONING_EFFORTS);
  fillSelectOptions(ui.settings.fallbackReasoningEffort, REASONING_EFFORTS);
  fillSelectOptions(ui.settings.themePreset, THEME_PRESETS);
  fillSelectOptions(ui.settings.naiDialect, NAI_DIALECT_OPTIONS);
  fillSelectOptions(ui.library.naiDialect, NAI_DIALECT_OPTIONS);
  fillSelectOptions(ui.library.themePreset, THEME_PRESETS);
  fillSelectOptions(ui.settings.fallbackProviderPreset, PROVIDER_PRESETS);
  fillSelectOptions(ui.settings.fallbackProtocol, PROTOCOL_OPTIONS);
  fillSelectOptions(ui.library.providerPreset, PROVIDER_PRESETS);
  fillSelectOptions(ui.library.protocol, PROTOCOL_OPTIONS);
  fillSelectOptions(ui.library.fallbackProviderPreset, PROVIDER_PRESETS);
  fillSelectOptions(ui.library.fallbackProtocol, PROTOCOL_OPTIONS);
  renderPromptLibraryOptions();

  // 协议和 Endpoint 只要一动就重算警告。等请求发出去才报错的话，
  // 用户已经白等一次，看到的还是服务端那句看不懂的 schema 错。
  [
    ui.settings.protocol, ui.settings.endpoint,
    ui.settings.fallbackProtocol, ui.settings.fallbackEndpoint,
    ui.library.protocol, ui.library.endpoint,
    ui.library.fallbackProtocol, ui.library.fallbackEndpoint,
  ].filter(Boolean).forEach((field) => {
    field.addEventListener('change', updateEndpointWarnings);
    field.addEventListener('input', updateEndpointWarnings);
  });

  ui.settings.providerPreset.addEventListener('change', () => syncProviderFields('primary'));
  ui.settings.fallbackProviderPreset.addEventListener('change', () => syncProviderFields('fallback'));
  ui.settings.enableFallbackModel.addEventListener('change', () => updateFallbackSettingsVisibility());
  ui.settings.activePresetId.addEventListener('change', () => {
    const previousId = state.settings.activePresetId;
    const blocks = readBlocksFromEditor();
    if (blocks.length && previousId) persistActivePreset(blocks, previousId);
    state.settings.activePresetId = ui.settings.activePresetId.value;
    renderPresetSelector();
    renderPresetEditor('settings');
  });
  ui.settings.presetName?.addEventListener('change', () => {
    if (applyActivePresetName('settings')) {
      renderPresetSelector();
      saveCustomPresets();
    }
  });
  if (ui.settings.enableBooruTagContext) {
    ui.settings.enableBooruTagContext.addEventListener('change', () => updateBooruTagTypesVisibility());
  }
  ui.settings.themePreset.addEventListener('change', () => {
    state.settings.themePreset = ui.settings.themePreset.value || DEFAULT_SETTINGS.themePreset;
    applyThemePreset();
    applyLibrarySettingsToInputs();
  });
  ui.settings.showReverseFloatingBall.addEventListener('change', () => {
    state.settings.showReverseFloatingBall = Boolean(ui.settings.showReverseFloatingBall.checked);
    updateFabVisibility();
    applyLibrarySettingsToInputs();
  });
  ui.settings.showWorkbenchFloatingBall.addEventListener('change', () => {
    state.settings.showWorkbenchFloatingBall = Boolean(ui.settings.showWorkbenchFloatingBall.checked);
    updateFabVisibility();
    applyLibrarySettingsToInputs();
  });
  ui.settings.showExternalFloatingBall?.addEventListener('change', () => {
    state.settings.showExternalFloatingBall = Boolean(ui.settings.showExternalFloatingBall.checked);
    updateFabVisibility();
    applyLibrarySettingsToInputs();
  });
  ui.settings.glassEffect?.addEventListener('change', () => {
    state.settings.glassEffect = Boolean(ui.settings.glassEffect.checked);
    applyThemePreset();
    applyLibrarySettingsToInputs();
  });
  ui.settings.glassStrength?.addEventListener('input', () => {
    state.settings.glassStrength = Number(ui.settings.glassStrength.value);
    applyThemePreset();
  });
  ui.settings.glassStrength?.addEventListener('change', () => applyLibrarySettingsToInputs());
  ui.library.glassStrength?.addEventListener('input', () => {
    state.settings.glassStrength = Number(ui.library.glassStrength.value);
    applyThemePreset();
  });
  ui.library.category?.addEventListener('change', () => updateLibraryAliasVisibility());
  ui.library.glassStrength?.addEventListener('change', () => saveLibrarySettings());
  ui.library.themePreset?.addEventListener('change', () => saveLibrarySettings());
  ui.library.showReverseFloatingBall?.addEventListener('change', () => saveLibrarySettings());
  ui.library.showWorkbenchFloatingBall?.addEventListener('change', () => saveLibrarySettings());
  ui.library.showExternalFloatingBall?.addEventListener('change', () => saveLibrarySettings());
  ui.library.glassEffect?.addEventListener('change', () => saveLibrarySettings());
  ui.library.providerPreset?.addEventListener('change', () => syncLibraryProviderFields('primary'));
  ui.library.fallbackProviderPreset?.addEventListener('change', () => syncLibraryProviderFields('fallback'));
  ui.wb.presetId?.addEventListener('change', () => {
    const previousId = state.settings.activePresetId;
    const blocks = readWorkbenchBlocksFromEditor();
    if (blocks.length && previousId) persistActivePreset(blocks, previousId);
    state.settings.activePresetId = ui.wb.presetId.value;
    renderWorkbenchPresetSelector();
    renderPresetEditor('workbench');
  });
  ui.wb.presetName?.addEventListener('change', () => {
    if (applyActivePresetName('workbench')) {
      renderWorkbenchPresetSelector();
      saveCustomPresets();
    }
  });

  // 右下悬浮球 = 悬浮窗；工作台走浏览器扩展图标。两个入口各开各的界面。
  // 球本身可以拖着换位置，拖过就不算点击。
  bindFabDrag(() => openPanel());
  bindPanelInteractions();
  bindDrawerResize();
  bindTextareaAutosize();
  applyPanelLayout(state.panelLayout);
  applyDrawerWidth(state.drawerLayout);

  // Direct tab listeners: avoid delegated click edge cases.
  ui.navButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      setPage(btn.dataset.page);
    });
  });

  root.addEventListener('mousedown', (event) => {
    const chip = event.target instanceof HTMLElement
      ? event.target.closest('[data-action="insert-variable"], [data-action="wb-insert-variable"]')
      : null;
    if (chip) event.preventDefault();
  }, true);

  root.addEventListener('click', async (event) => {
    const actionTarget = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
    if (!actionTarget) return;

    const action = actionTarget.getAttribute('data-action');

    if (action === 'close') closePanel();
    else if (action === 'close-drawer') closeLibraryDrawer();
    else if (action === 'pick') startPickMode();
    else if (action === 'workbench-open-agent') openAgentWorkbenchPanel();
    else if (action === 'workbench-open-flow') openFlowWorkbenchPanel();
    else if (action === 'send-flow') sendToFlowEditor(state.lastResult);
    else if (action === 'reverse') {
      if (state.pending) await cancelCurrentRun();
      else await reverseAndCopy();
    }
    else if (action === 'copy') {
      const copied = await copyText(state.lastResult);
      setStatus(copied ? T.statusCopied : T.statusCopyFailed, !copied);
    } else if (action === 'pick-model') applyModelChip(actionTarget);
    else if (action === 'fetch-models') await fetchModelsFor('primary');
    else if (action === 'fetch-fallback-models') await fetchModelsFor('fallback');
    else if (action === 'test-connection') await testConnection();
    else if (action === 'wrap-code') await wrapCurrentResult();
    else if (action === 'apply-role-library') applyPromptLibraryToRolePrompt();
    else if (action === 'workbench-toggle-sidebar') toggleWorkbenchSidebar();
    else if (action === 'workbench-open-settings') openLibrarySettingsPanel();
    else if (action === 'workbench-open-presets') openPresetsPanel();
    else if (action === 'workbench-open-artists') openArtistWorkbenchPanel();
    else if (action === 'toggle-key-help') toggleApiKeyHelp();
    else if (actionTarget.dataset.workbenchPage === 'library') openLibraryIndexPanel();
    else if (action === 'library-close-editor') closeLibraryEditor();
    else if (action === 'library-new') {
      resetLibraryEditor();
      openLibraryEditor();
      ui.library.name?.focus();
    }
    else if (action === 'library-save-sync') await saveLibraryEditorAndSync();
    else if (action === 'library-edit') editLibraryEntry(actionTarget.dataset.id);
    else if (action === 'library-copy') await copyLibraryEntry(actionTarget.dataset.id);
    else if (action === 'library-sync') await syncLibraryEntryById(actionTarget.dataset.id);
    else if (action === 'library-delete') await deleteLibraryEntry(actionTarget.dataset.id);
    else if (action === 'library-save-settings') await saveLibrarySettings();
    else if (action === 'library-fetch-models') await fetchLibraryModelsFor('primary');
    else if (action === 'library-fetch-fallback-models') await fetchLibraryModelsFor('fallback');
    else if (action === 'library-test-connection') await testLibraryConnection();
    else if (action === 'library-apply-role-library') applyPromptLibraryToLibraryRolePrompt();
    else if (action === 'duplicate-preset') handleDuplicatePreset();
    else if (action === 'new-preset') handleNewPreset();
    else if (action === 'delete-preset') handleDeletePreset();
    else if (action === 'reset-preset') handleResetPreset();
    else if (action === 'open-image') await openLocalImageFile();
    else if (action === 'add-block') handleAddBlock();
    else if (action === 'insert-variable') insertVariableAtCursor(actionTarget.dataset.variable || '');
    else if (action === 'wb-duplicate-preset') {
      syncActivePresetIdFromUI();
      duplicatePreset(state.settings.activePresetId);
      state.settings.activePresetId = state.customPresets[state.customPresets.length - 1].id;
      renderWorkbenchPresetSelector();
      renderPresetEditor('workbench');
      saveCustomPresets();
    }
    else if (action === 'wb-new-preset') {
      createPreset('自定义预设');
      state.settings.activePresetId = state.customPresets[state.customPresets.length - 1].id;
      renderWorkbenchPresetSelector();
      renderPresetEditor('workbench');
      saveCustomPresets();
    }
    else if (action === 'wb-delete-preset') {
      syncActivePresetIdFromUI();
      const a = getActivePreset();
      if (!a.builtIn) {
        deletePreset(a.id);
        renderWorkbenchPresetSelector();
        renderPresetEditor('workbench');
        saveCustomPresets();
      }
    }
    else if (action === 'wb-reset-preset') {
      syncActivePresetIdFromUI();
      resetPresetToDefault(state.settings.activePresetId);
      renderWorkbenchPresetSelector();
      renderPresetEditor('workbench');
      saveCustomPresets();
    }
    else if (action === 'wb-add-block') appendActivePresetBlock('workbench');
    else if (action === 'wb-insert-variable') insertWorkbenchVariableAtCursor(actionTarget.dataset.variable || '');
    else if (action === 'wb-save-presets') await saveWorkbenchPresets();
    else if (action === 'wb-apply-role-library') { const sel = ui.wb.roleLibrarySelect; const entry = state.promptLibrary.find((x) => x.id === sel?.value && x.category === ROLE_LIBRARY_CATEGORY); if (entry && ui.wb.rolePrompt) { ui.wb.rolePrompt.value = entry.tags.map((t, i) => `${t}${entry.delimiters?.[i] || ''}`).join(''); } }
    else if (action === 'save-settings') await saveSettings();
    else if (action === 'clear-history') await clearHistory();
    else if (action === 'history-copy') {
      const item = state.history.find((x) => x.id === actionTarget.dataset.id);
      const copied = await copyText(item?.result || '');
      setStatus(copied ? T.statusCopied : T.statusCopyFailed, !copied);
    } else if (action === 'history-use') {
      const item = state.history.find((x) => x.id === actionTarget.dataset.id);
      if (!item) return;
      setResult(item.result || '');
      openPanel('reverse');
      setStatus(T.statusLoadedHistory, false);
    }
  });
}
