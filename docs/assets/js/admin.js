(function () {
  const OWNER = "Agent-Immergence";
  const REPO = "Agent-Immergence.github.io";
  const BRANCH = "main";
  const DATA_PATH = "docs/assets/data/site-data.json";
  const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const TOKEN_KEY = "agentImmergenceGithubToken";

  let state = createEmptyState();
  let paperFileInputs = {};
  let noteFileInputs = {};

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    els.tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
    loadPublicData();
  });

  function cacheElements() {
    els.tokenInput = document.getElementById("tokenInput");
    els.saveTokenButton = document.getElementById("saveTokenButton");
    els.loadRepoButton = document.getElementById("loadRepoButton");
    els.saveRepoButton = document.getElementById("saveRepoButton");
    els.addMemberButton = document.getElementById("addMemberButton");
    els.addCourseButton = document.getElementById("addCourseButton");
    els.addSharedPaperButton = document.getElementById("addSharedPaperButton");
    els.addPrivatePaperButton = document.getElementById("addPrivatePaperButton");
    els.memberEditor = document.getElementById("memberEditor");
    els.courseEditor = document.getElementById("courseEditor");
    els.sharedPaperEditor = document.getElementById("sharedPaperEditor");
    els.privatePaperEditor = document.getElementById("privatePaperEditor");
    els.status = document.getElementById("adminStatus");
  }

  function bindEvents() {
    els.saveTokenButton.addEventListener("click", () => {
      localStorage.setItem(TOKEN_KEY, els.tokenInput.value.trim());
      setStatus("Token 已保存到当前浏览器。");
    });

    els.loadRepoButton.addEventListener("click", () => withBusy(loadRepoData));
    els.saveRepoButton.addEventListener("click", () => withBusy(saveRepoData));
    els.addMemberButton.addEventListener("click", addMember);
    els.addCourseButton.addEventListener("click", addCourse);
    els.addSharedPaperButton.addEventListener("click", () => addPaper("shared"));
    els.addPrivatePaperButton.addEventListener("click", () => addPaper("notShared"));
  }

  async function loadPublicData() {
    try {
      setStatus("正在读取公开数据...");
      const response = await fetch(`/assets/data/site-data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      state = normalizeData(await response.json());
      renderAll();
      setStatus("已读取公开数据。");
    } catch (error) {
      setStatus(`读取失败：${error.message}`);
      renderAll();
    }
  }

  async function loadRepoData() {
    const token = getToken();
    setStatus("正在读取仓库数据...");
    const file = await githubRequest(`contents/${DATA_PATH}?ref=${BRANCH}`, { token });
    state = normalizeData(JSON.parse(decodeBase64Utf8(file.content || "")));
    paperFileInputs = {};
    noteFileInputs = {};
    renderAll();
    setStatus("已读取仓库数据。");
  }

  async function saveRepoData() {
    const token = getToken();
    collectStateFromDom();
    setStatus("正在准备提交...");

    const ref = await githubRequest(`git/ref/heads/${BRANCH}`, { token });
    const baseCommitSha = ref.object.sha;
    const baseCommit = await githubRequest(`git/commits/${baseCommitSha}`, { token });
    const treeEntries = [];

    for (const upload of await collectUploads()) {
      const blob = await githubRequest("git/blobs", {
        token,
        method: "POST",
        body: {
          content: upload.base64,
          encoding: "base64",
        },
      });
      treeEntries.push({
        path: upload.repoPath,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const dataBlob = await githubRequest("git/blobs", {
      token,
      method: "POST",
      body: {
        content: bytesToBase64(new TextEncoder().encode(`${JSON.stringify(state, null, 2)}\n`)),
        encoding: "base64",
      },
    });
    treeEntries.push({
      path: DATA_PATH,
      mode: "100644",
      type: "blob",
      sha: dataBlob.sha,
    });

    const tree = await githubRequest("git/trees", {
      token,
      method: "POST",
      body: {
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      },
    });

    const commit = await githubRequest("git/commits", {
      token,
      method: "POST",
      body: {
        message: "Update website data",
        tree: tree.sha,
        parents: [baseCommitSha],
      },
    });

    await githubRequest(`git/refs/heads/${BRANCH}`, {
      token,
      method: "PATCH",
      body: {
        sha: commit.sha,
      },
    });

    paperFileInputs = {};
    noteFileInputs = {};
    renderAll();
    setStatus("已保存。网站会在 GitHub Actions 完成后更新。");
  }

  async function collectUploads() {
    const uploads = [];

    for (const [key, file] of Object.entries(paperFileInputs)) {
      if (!file) continue;
      const path = `files/papers/${safeFileName(file.name)}`;
      setPaperPathFromKey(key, path, "paperPath");
      uploads.push({
        repoPath: `docs/${path}`,
        base64: await fileToBase64(file),
      });
    }

    for (const [key, file] of Object.entries(noteFileInputs)) {
      if (!file) continue;
      const path = `files/notes/${safeFileName(file.name)}`;
      setPaperPathFromKey(key, path, "notePath");
      uploads.push({
        repoPath: `docs/${path}`,
        base64: await fileToBase64(file),
      });
    }

    return uploads;
  }

  function setPaperPathFromKey(key, path, field) {
    const [section, rawIndex] = key.split(":");
    const index = Number(rawIndex);
    if (!state.papers[section] || !state.papers[section][index]) return;
    state.papers[section][index][field] = path;
  }

  function renderAll() {
    renderMemberEditor();
    renderCourseEditor();
    renderPaperEditor("shared", els.sharedPaperEditor);
    renderPaperEditor("notShared", els.privatePaperEditor);
  }

  function renderMemberEditor() {
    const rows = state.members
      .map(
        (member, index) => `
          <tr>
            <td><input data-member-name="${index}" value="${escapeAttribute(member.name)}" /></td>
            <td><button type="button" class="danger-button" data-delete-member="${index}">删除</button></td>
          </tr>
        `
      )
      .join("");

    els.memberEditor.innerHTML = `
      <div class="editor-table-wrap">
        <table class="editor-table">
          <thead><tr><th>成员</th><th>操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="2" class="muted-text">暂无成员。</td></tr>`}</tbody>
        </table>
      </div>
    `;

    els.memberEditor.querySelectorAll("[data-member-name]").forEach((input) => {
      input.addEventListener("input", () => {
        state.members[Number(input.dataset.memberName)].name = input.value;
      });
    });

    els.memberEditor.querySelectorAll("[data-delete-member]").forEach((button) => {
      button.addEventListener("click", () => deleteMember(Number(button.dataset.deleteMember)));
    });
  }

  function renderCourseEditor() {
    const headers = state.courses
      .map(
        (course, index) => `
          <th>
            <input data-course-name="${index}" value="${escapeAttribute(course.name)}" />
            <button type="button" class="danger-button" data-delete-course="${index}">删除</button>
          </th>
        `
      )
      .join("");

    const rows = state.members
      .map((member) => {
        const cells = state.courses
          .map(
            (course) => `
              <td>
                <input
                  data-progress-member="${escapeAttribute(member.id)}"
                  data-progress-course="${escapeAttribute(course.id)}"
                  value="${escapeAttribute(state.courseProgress[member.id]?.[course.id] || "")}"
                />
              </td>
            `
          )
          .join("");

        return `
          <tr>
            <td>${escapeHtml(member.name)}</td>
            ${cells}
          </tr>
        `;
      })
      .join("");

    els.courseEditor.innerHTML = `
      <div class="editor-table-wrap">
        <table class="editor-table">
          <thead>
            <tr>
              <th>成员</th>
              ${headers}
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${state.courses.length + 1}" class="muted-text">暂无课程。</td></tr>`}</tbody>
        </table>
      </div>
    `;

    els.courseEditor.querySelectorAll("[data-course-name]").forEach((input) => {
      input.addEventListener("input", () => {
        state.courses[Number(input.dataset.courseName)].name = input.value;
      });
    });

    els.courseEditor.querySelectorAll("[data-delete-course]").forEach((button) => {
      button.addEventListener("click", () => deleteCourse(Number(button.dataset.deleteCourse)));
    });

    els.courseEditor.querySelectorAll("[data-progress-member]").forEach((input) => {
      input.addEventListener("input", () => {
        const memberId = input.dataset.progressMember;
        const courseId = input.dataset.progressCourse;
        state.courseProgress[memberId] ||= {};
        state.courseProgress[memberId][courseId] = input.value;
      });
    });
  }

  function renderPaperEditor(section, root) {
    const rows = state.papers[section]
      .map((paper, index) => {
        const key = `${section}:${index}`;
        return `
          <tr>
            <td><input data-paper-field="${key}:title" value="${escapeAttribute(paper.title || "")}" /></td>
            <td>
              <div class="file-field">
                <input data-paper-field="${key}:paperPath" value="${escapeAttribute(paper.paperPath || "")}" />
                <input data-paper-file="${key}" type="file" />
              </div>
            </td>
            <td>
              <div class="file-field">
                <input data-paper-field="${key}:notePath" value="${escapeAttribute(paper.notePath || "")}" />
                <input data-note-file="${key}" type="file" />
              </div>
            </td>
            <td><input data-paper-field="${key}:reader" value="${escapeAttribute(paper.reader || "")}" /></td>
            <td><input data-paper-field="${key}:readDate" type="date" value="${escapeAttribute(paper.readDate || "")}" /></td>
            <td><input data-paper-completed="${key}" type="checkbox" ${paper.completed ? "checked" : ""} /></td>
            <td><button type="button" class="danger-button" data-delete-paper="${key}">删除</button></td>
          </tr>
        `;
      })
      .join("");

    root.innerHTML = `
      <div class="editor-table-wrap">
        <table class="editor-table">
          <thead>
            <tr>
              <th>论文名称</th>
              <th>论文</th>
              <th>论文笔记</th>
              <th>阅读人</th>
              <th>阅读时间</th>
              <th>是否完成</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted-text">暂无论文。</td></tr>`}</tbody>
        </table>
      </div>
    `;

    root.querySelectorAll("[data-paper-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const [paperSection, rawIndex, field] = input.dataset.paperField.split(":");
        state.papers[paperSection][Number(rawIndex)][field] = input.value;
      });
    });

    root.querySelectorAll("[data-paper-completed]").forEach((input) => {
      input.addEventListener("change", () => {
        const [paperSection, rawIndex] = input.dataset.paperCompleted.split(":");
        state.papers[paperSection][Number(rawIndex)].completed = input.checked;
      });
    });

    root.querySelectorAll("[data-paper-file]").forEach((input) => {
      input.addEventListener("change", () => {
        paperFileInputs[input.dataset.paperFile] = input.files?.[0] || null;
      });
    });

    root.querySelectorAll("[data-note-file]").forEach((input) => {
      input.addEventListener("change", () => {
        noteFileInputs[input.dataset.noteFile] = input.files?.[0] || null;
      });
    });

    root.querySelectorAll("[data-delete-paper]").forEach((button) => {
      button.addEventListener("click", () => {
        const [paperSection, rawIndex] = button.dataset.deletePaper.split(":");
        state.papers[paperSection].splice(Number(rawIndex), 1);
        renderAll();
      });
    });
  }

  function addMember() {
    const id = uniqueId("member", state.members.map((member) => member.id));
    state.members.push({ id, name: `Member ${state.members.length + 1}` });
    state.courseProgress[id] = {};
    state.courses.forEach((course) => {
      state.courseProgress[id][course.id] = "";
    });
    renderAll();
  }

  function deleteMember(index) {
    const member = state.members[index];
    if (!member) return;
    state.members.splice(index, 1);
    delete state.courseProgress[member.id];
    renderAll();
  }

  function addCourse() {
    const id = uniqueId("course", state.courses.map((course) => course.id));
    state.courses.push({ id, name: `Course ${state.courses.length + 1}` });
    state.members.forEach((member) => {
      state.courseProgress[member.id] ||= {};
      state.courseProgress[member.id][id] = "";
    });
    renderAll();
  }

  function deleteCourse(index) {
    const course = state.courses[index];
    if (!course) return;
    state.courses.splice(index, 1);
    Object.values(state.courseProgress).forEach((progress) => {
      delete progress[course.id];
    });
    renderAll();
  }

  function addPaper(section) {
    state.papers[section].push({
      title: "",
      paperPath: "",
      notePath: "",
      reader: state.members[0]?.name || "",
      readDate: new Date().toISOString().slice(0, 10),
      completed: false,
    });
    renderAll();
  }

  function collectStateFromDom() {
    document.querySelectorAll("[data-member-name]").forEach((input) => {
      state.members[Number(input.dataset.memberName)].name = input.value;
    });

    document.querySelectorAll("[data-course-name]").forEach((input) => {
      state.courses[Number(input.dataset.courseName)].name = input.value;
    });

    document.querySelectorAll("[data-progress-member]").forEach((input) => {
      const memberId = input.dataset.progressMember;
      const courseId = input.dataset.progressCourse;
      state.courseProgress[memberId] ||= {};
      state.courseProgress[memberId][courseId] = input.value;
    });

    document.querySelectorAll("[data-paper-field]").forEach((input) => {
      const [section, rawIndex, field] = input.dataset.paperField.split(":");
      state.papers[section][Number(rawIndex)][field] = input.value;
    });

    document.querySelectorAll("[data-paper-completed]").forEach((input) => {
      const [section, rawIndex] = input.dataset.paperCompleted.split(":");
      state.papers[section][Number(rawIndex)].completed = input.checked;
    });
  }

  async function githubRequest(path, options = {}) {
    const response = await fetch(`${API_ROOT}/${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async function withBusy(task) {
    setButtonsDisabled(true);
    try {
      await task();
    } catch (error) {
      setStatus(`操作失败：${error.message}`);
    } finally {
      setButtonsDisabled(false);
    }
  }

  function setButtonsDisabled(disabled) {
    [
      els.saveTokenButton,
      els.loadRepoButton,
      els.saveRepoButton,
      els.addMemberButton,
      els.addCourseButton,
      els.addSharedPaperButton,
      els.addPrivatePaperButton,
    ].forEach((button) => {
      button.disabled = disabled;
    });
  }

  function getToken() {
    const token = els.tokenInput.value.trim() || localStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new Error("缺少 GitHub Token。");
    }
    localStorage.setItem(TOKEN_KEY, token);
    return token;
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function normalizeData(data) {
    const normalized = {
      members: Array.isArray(data.members) ? data.members : [],
      courses: Array.isArray(data.courses) ? data.courses : [],
      courseProgress: data.courseProgress || {},
      papers: {
        shared: Array.isArray(data.papers?.shared) ? data.papers.shared : [],
        notShared: Array.isArray(data.papers?.notShared) ? data.papers.notShared : [],
      },
    };

    normalized.members.forEach((member, index) => {
      member.id ||= uniqueId("member", normalized.members.map((item) => item.id).filter(Boolean), index + 1);
      member.name ||= member.id;
      normalized.courseProgress[member.id] ||= {};
    });

    normalized.courses.forEach((course, index) => {
      course.id ||= uniqueId("course", normalized.courses.map((item) => item.id).filter(Boolean), index + 1);
      course.name ||= course.id;
    });

    normalized.members.forEach((member) => {
      normalized.courses.forEach((course) => {
        normalized.courseProgress[member.id][course.id] ||= "";
      });
    });

    ["shared", "notShared"].forEach((section) => {
      normalized.papers[section] = normalized.papers[section].map((paper) => ({
        title: paper.title || "",
        paperPath: paper.paperPath || "",
        notePath: paper.notePath || "",
        reader: paper.reader || "",
        readDate: paper.readDate || "",
        completed: Boolean(paper.completed),
      }));
    });

    return normalized;
  }

  function createEmptyState() {
    return {
      members: [],
      courses: [],
      courseProgress: {},
      papers: {
        shared: [],
        notShared: [],
      },
    };
  }

  function uniqueId(prefix, existing, start = 1) {
    const used = new Set(existing);
    let index = start;
    let candidate = `${prefix}-${index}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${prefix}-${index}`;
    }
    return candidate;
  }

  function safeFileName(name) {
    const clean = name
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return clean || `file-${Date.now()}`;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.split(",")[1] || "");
      };
      reader.onerror = () => reject(reader.error || new Error("文件读取失败。"));
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();

