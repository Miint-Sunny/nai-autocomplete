// skill 仓库。skill 就是一份带 YAML frontmatter 的 markdown，外加若干参考资料。
// 内置的 nai5-prompting 始终在列且删不掉；用户可以导入自己的、也可以直接改正文。

const AGENT_SKILLS_KEY = 'nai-agent-skills';
const AGENT_ACTIVE_SKILL_KEY = 'nai-agent-active-skill';
const AGENT_SKILL_BODY_LIMIT = 120000;
const AGENT_REFERENCE_LIMIT = 6;

function parseSkillFrontmatter(text) {
  const source = String(text || '').replace(/^﻿/, '');
  if (!source.startsWith('---')) return { meta: {}, body: source.trim() };

  const end = source.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: source.trim() };

  const meta = {};
  for (const line of source.slice(source.indexOf('\n') + 1, end).split('\n')) {
    const match = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    meta[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }

  const bodyStart = source.indexOf('\n', end + 1);
  return { meta, body: (bodyStart < 0 ? '' : source.slice(bodyStart + 1)).trim() };
}

function normalizeAgentSkill(raw) {
  const body = String(raw?.body || '').trim().slice(0, AGENT_SKILL_BODY_LIMIT);
  if (!body) return null;

  return {
    id: String(raw.id || createId('skill')),
    builtin: false,
    name: String(raw.name || '未命名 skill').trim().slice(0, 60),
    description: String(raw.description || '').trim().slice(0, 400),
    body,
    references: (Array.isArray(raw.references) ? raw.references : [])
      .slice(0, AGENT_REFERENCE_LIMIT)
      .map((reference) => ({
        name: String(reference?.name || 'reference').trim().slice(0, 60),
        content: String(reference?.content || '').trim().slice(0, AGENT_SKILL_BODY_LIMIT),
      }))
      .filter((reference) => reference.content),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function agentSkillList() {
  return [BUILTIN_AGENT_SKILL, ...state.agent.skills];
}

function getActiveAgentSkill() {
  const list = agentSkillList();
  return list.find((skill) => skill.id === state.agent.activeSkillId) || list[0];
}

async function loadAgentSkills() {
  const data = await storageGet([AGENT_SKILLS_KEY, AGENT_ACTIVE_SKILL_KEY]);
  const stored = Array.isArray(data[AGENT_SKILLS_KEY]) ? data[AGENT_SKILLS_KEY] : [];
  state.agent.skills = stored.map(normalizeAgentSkill).filter(Boolean);
  const activeId = String(data[AGENT_ACTIVE_SKILL_KEY] || '');
  state.agent.activeSkillId = agentSkillList().some((skill) => skill.id === activeId)
    ? activeId
    : BUILTIN_AGENT_SKILL.id;
  state.agent.loaded = true;
}

async function saveAgentSkills() {
  await storageSet({
    [AGENT_SKILLS_KEY]: state.agent.skills,
    [AGENT_ACTIVE_SKILL_KEY]: state.agent.activeSkillId,
  });
}

async function setActiveAgentSkill(id) {
  if (!agentSkillList().some((skill) => skill.id === id)) return;
  state.agent.activeSkillId = id;
  state.agent.editing = null;
  await saveAgentSkills();
  renderAgentPanel();
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsText(file);
  });
}

// 多份文件被拼进同一个文本域时，各份之间插这行。用 HTML 注释是因为它在
// markdown 里是隐形的 —— 用户把整段拷去别处也不碍事，删掉它就等于把两份并成一份。
const AGENT_SKILL_FILE_MARK = /^<!--\s*nai-file:\s*(.*?)\s*-->\s*$/;

function joinSkillFileTexts(items) {
  return items
    .map((item, index) => (index === 0
      ? String(item.text || '').trim()
      : `<!-- nai-file: ${item.name} -->\n${String(item.text || '').trim()}`))
    .filter((section) => section)
    .join('\n\n');
}

function splitSkillFileTexts(text) {
  const sections = [];
  let current = { name: '', lines: [] };

  String(text || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    const match = line.match(AGENT_SKILL_FILE_MARK);
    if (!match) {
      current.lines.push(line);
      return;
    }
    sections.push(current);
    current = { name: match[1] || 'reference', lines: [] };
  });
  sections.push(current);

  return sections
    .map((section) => ({ name: section.name, text: section.lines.join('\n').trim() }))
    .filter((section) => section.text);
}

// 用户手上的 skill 通常是一个目录：主文件 + references/。多选也好、粘一整段也好，
// 到这儿都是若干份文本：带 frontmatter name 的当正文，其余当参考资料 ——
// 不要求用户按什么顺序选。
function buildSkillFromTexts(items) {
  const parsed = items
    .filter((item) => String(item?.text || '').trim())
    .map((item) => ({ name: item.name || '', text: item.text, ...parseSkillFrontmatter(item.text) }));

  if (!parsed.length) throw new Error('没有读到内容');

  const mainIndex = parsed.findIndex((item) => item.meta.name);
  const main = parsed[mainIndex >= 0 ? mainIndex : 0];
  const references = parsed.filter((item) => item !== main);

  const fallbackName = String(main.name || '').replace(/\.(md|markdown|txt)$/i, '').trim();
  return normalizeAgentSkill({
    name: main.meta.name || fallbackName || '未命名 skill',
    description: main.meta.description || '',
    body: main.body,
    references: references.map((item) => ({ name: item.name || 'reference', content: item.text })),
  });
}

// ── 导入盒子用的两个钩子 ────────────────────────────────────────

function describeAgentSkillImport(text) {
  if (!String(text || '').trim()) return { ok: false, summary: '' };

  try {
    const skill = buildSkillFromTexts(splitSkillFileTexts(text));
    if (!skill) throw new Error('skill 正文是空的');

    const parts = [`「${skill.name}」 · 正文 ${skill.body.length} 字`];
    if (skill.description) parts.push(`描述：${skill.description.slice(0, 40)}${skill.description.length > 40 ? '…' : ''}`);
    if (skill.references.length) parts.push(`${skill.references.length} 份参考资料`);
    const existing = state.agent.skills.some((item) => item.name === skill.name);
    if (existing) parts.push('同名的会被覆盖');
    return { ok: true, summary: parts.join(' · ') };
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : String(error) };
  }
}

async function commitAgentSkillImport(text) {
  const skill = buildSkillFromTexts(splitSkillFileTexts(text));
  if (!skill) throw new Error('skill 正文是空的');

  const existing = state.agent.skills.findIndex((item) => item.name === skill.name);
  if (existing >= 0) state.agent.skills[existing] = skill;
  else state.agent.skills.push(skill);

  state.agent.activeSkillId = skill.id;
  state.agent.editing = null;
  await saveAgentSkills();
  renderAgentPanel();
  return `已装载 skill：${skill.name}${skill.references.length ? `（含 ${skill.references.length} 份参考资料）` : ''}。`;
}

// 内置 skill 不能就地改 —— 改了就没有兜底了。第一次编辑自动复制成一份用户 skill。
async function saveActiveAgentSkillBody(body) {
  const text = String(body || '').trim();
  if (!text) {
    setStatus('skill 正文不能为空。', true);
    return;
  }

  const active = getActiveAgentSkill();

  if (active.builtin) {
    const copy = normalizeAgentSkill({
      name: `${active.name}（我的）`,
      description: active.description,
      body: text,
      references: active.references,
    });
    state.agent.skills.push(copy);
    state.agent.activeSkillId = copy.id;
    setStatus(`内置 skill 保持原样，已另存为「${copy.name}」并切换过去。`, false);
  } else {
    const index = state.agent.skills.findIndex((skill) => skill.id === active.id);
    if (index < 0) return;
    state.agent.skills[index] = { ...state.agent.skills[index], body: text, updatedAt: Date.now() };
    setStatus(`已保存 skill：${active.name}。`, false);
  }

  state.agent.editing = null;
  await saveAgentSkills();
  renderAgentPanel();
}

async function deleteActiveAgentSkill() {
  const active = getActiveAgentSkill();
  if (active.builtin) {
    setStatus('内置 skill 不能删除。', true);
    return;
  }

  state.agent.skills = state.agent.skills.filter((skill) => skill.id !== active.id);
  state.agent.activeSkillId = BUILTIN_AGENT_SKILL.id;
  state.agent.editing = null;
  await saveAgentSkills();
  renderAgentPanel();
  setStatus(`已删除 skill：${active.name}。`, false);
}

function serializeAgentSkill(skill) {
  const front = [
    '---',
    `name: ${skill.name}`,
    skill.description ? `description: ${skill.description}` : '',
    '---',
    '',
  ].filter((line) => line !== '').join('\n');
  return `${front}\n${skill.body}\n`;
}

function exportActiveAgentSkill() {
  const skill = getActiveAgentSkill();
  const blob = new Blob([serializeAgentSkill(skill)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${skill.name.replace(/[\\/:*?"<>|]+/g, '_')}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`已导出 ${skill.name}.md（参考资料需要单独保存）。`, false);
}
