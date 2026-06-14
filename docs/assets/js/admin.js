(function () {
  const OWNER = "Agent-Immergence";
  const REPO = "Agent-Immergence.github.io";
  const BRANCH = "main";
  const DATA_PATH = "docs/assets/data/site-data.json";
  const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const SITE_ORIGIN = "https://agent-immergence.github.io";
  const TOKEN_KEY = "agentImmergenceGithubToken";
  const TOKEN_URL =
    "https://github.com/settings/personal-access-tokens/new?name=Agent%20Immergence%20Website%20Editor&description=Edit%20course%20progress%20and%20paper%20reading%20data%20for%20Agent%20Immergence&target_name=Agent-Immergence&expires_in=90&contents=write";

  let state = createEmptyState();
  let paperFileInputs = {};
  let noteFileInputs = {};
  let noteFolderInputs = {};

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    els.tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
    loadPublicData();
  });

  function cacheElements() {
    els.tokenInput = document.getElementById("tokenInput");
    els.openTokenButton = document.getElementById("openTokenButton");
    els.saveTokenButton = document.getElementById("saveTokenButton");
    els.loadRepoButton = document.getElementById("loadRepoButton");
    els.saveRepoButton = document.getElementById("saveRepoButton");
    els.addMemberButton = document.getElementById("addMemberButton");
    els.addSharedPaperButton = document.getElementById("addSharedPaperButton");
    els.addPrivatePaperButton = document.getElementById("addPrivatePaperButton");
    els.memberEditor = document.getElementById("memberEditor");
    els.courseEditor = document.getElementById("courseEditor");
    els.sharedPaperEditor = document.getElementById("sharedPaperEditor");
    els.privatePaperEditor = document.getElementById("privatePaperEditor");
    els.status = document.getElementById("adminStatus");
  }

  function bindEvents() {
    els.openTokenButton.addEventListener("click", () => {
      const opened = window.open(TOKEN_URL, "_blank", "noopener,noreferrer");
      if (!opened) {
        setStatus("浏览器拦截了新窗口，请点击上方提示里的备用链接。");
      }
    });

    els.saveTokenButton.addEventListener("click", () => {
      localStorage.setItem(TOKEN_KEY, els.tokenInput.value.trim());
      setStatus("Token 已保存到当前浏览器。");
    });

    els.loadRepoButton.addEventListener("click", () => withBusy(loadRepoData));
    els.saveRepoButton.addEventListener("click", () => withBusy(saveRepoData));
    els.addMemberButton.addEventListener("click", addMember);
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
    noteFolderInputs = {};
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
    noteFolderInputs = {};
    renderAll();
    setStatus("已保存。网站会在 GitHub Actions 完成后更新。");
  }

  async function collectUploads() {
    const uploads = [];

    for (const [key, file] of Object.entries(paperFileInputs)) {
      if (!file) continue;
      const path = `files/papers/${timestampedFileName(file.name)}`;
      setPaperPathFromKey(key, path, "paperPath");
      uploads.push({
        repoPath: `docs/${path}`,
        base64: await fileToBase64(file),
      });
    }

    for (const [key, file] of Object.entries(noteFileInputs)) {
      if (!file) continue;
      const path = `files/notes/${timestampedFileName(file.name)}`;
      setPaperPathFromKey(key, path, "notePath");
      uploads.push({
        repoPath: `docs/${path}`,
        base64: await fileToBase64(file),
      });
    }

    for (const [key, files] of Object.entries(noteFolderInputs)) {
      const folderFiles = Array.from(files || []).filter(Boolean);
      if (folderFiles.length === 0) continue;

      const folderRoot = getFolderRootName(folderFiles[0]);
      const folderPath = `files/notes/${Date.now()}-${safeFileName(folderRoot)}`;
      const uploadedPaths = [];

      for (const file of folderFiles) {
        let relativePath = sanitizeFolderRelativePath(file);
        if (!relativePath) continue;
        if (relativePath.toLowerCase() === "index.md") {
          relativePath = "uploaded-index.md";
        }

        const notePath = `${folderPath}/${relativePath}`;
        uploadedPaths.push(relativePath);

        uploads.push({
          repoPath: `docs/${notePath}`,
          base64: await fileToBase64(file),
        });
      }

      const [section, rawIndex] = key.split(":");
      const paper = state.papers[section]?.[Number(rawIndex)];
      const title = paper?.title || folderRoot || "Paper Notes";
      const lines = uploadedPaths
        .sort((a, b) => a.localeCompare(b))
        .map((path) => folderIndexListItem(folderPath, path));
      const indexContent = `# ${title} 笔记文件夹\n\n<ul>\n${lines.join("\n")}\n</ul>\n`;
      const indexPath = `${folderPath}/index.md`;
      setPaperPathFromKey(key, indexPath, "notePath");
      uploads.push({
        repoPath: `docs/${indexPath}`,
        base64: bytesToBase64(new TextEncoder().encode(indexContent)),
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
        renderCourseHeadings();
      });
    });

    els.memberEditor.querySelectorAll("[data-delete-member]").forEach((button) => {
      button.addEventListener("click", () => deleteMember(Number(button.dataset.deleteMember)));
    });
  }

  function renderCourseEditor() {
    if (state.members.length === 0) {
      els.courseEditor.innerHTML = `<p class="muted-text">暂无成员。先添加成员，再添加课程表。</p>`;
      return;
    }

    els.courseEditor.innerHTML = state.members
      .map((member) => renderMemberCourseEditor(member))
      .join("");

    bindCourseEditorEvents();
  }

  function renderMemberCourseEditor(member) {
    const table = ensureCourseTable(member.id);
    const columns = table.columns;
    const rows = table.rows;
    const headers = columns
      .map(
        (column, index) => `
          <th>
            <div class="stacked-field">
              <input
                data-course-column-name="${escapeAttribute(member.id)}:${index}"
                value="${escapeAttribute(column.name)}"
                aria-label="课程名称"
              />
              <button type="button" class="danger-button" data-delete-course-column="${escapeAttribute(member.id)}:${index}">删除列</button>
            </div>
          </th>
        `
      )
      .join("");

    const body = rows.length
      ? rows
          .map((row, rowIndex) => {
            const cells = columns
              .map(
                (column) => `
                  <td>
                    <input
                      data-course-cell="${escapeAttribute(member.id)}:${escapeAttribute(row.id)}:${escapeAttribute(column.id)}"
                      value="${escapeAttribute(row.values?.[column.id] || "")}"
                    />
                  </td>
                `
              )
              .join("");

            return `
              <tr>
                <td>
                  <input
                    data-course-row-label="${escapeAttribute(member.id)}:${rowIndex}"
                    value="${escapeAttribute(row.label || "")}"
                    aria-label="进度行名称"
                  />
                </td>
                ${cells}
                <td><button type="button" class="danger-button" data-delete-course-row="${escapeAttribute(member.id)}:${rowIndex}">删除行</button></td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="${columns.length + 2}" class="muted-text">暂无进度行。</td></tr>`;

    return `
      <section class="member-course-editor" data-member-course-section="${escapeAttribute(member.id)}">
        <div class="table-actions">
          <h3 data-course-heading="${escapeAttribute(member.id)}">${escapeHtml(member.name)}</h3>
          <div class="toolbar-actions">
            <button type="button" class="primary-button" data-add-course-column="${escapeAttribute(member.id)}">添加课程列</button>
            <button type="button" class="primary-button" data-add-course-row="${escapeAttribute(member.id)}">添加进度行</button>
          </div>
        </div>
        <div class="editor-table-wrap">
          <table class="editor-table">
            <thead>
              <tr>
                <th>
                  <div class="course-corner-tools">
                    <span>进度</span>
                    <button type="button" class="primary-button" data-add-course-column="${escapeAttribute(member.id)}">添加课程列</button>
                    <button type="button" class="primary-button" data-add-course-row="${escapeAttribute(member.id)}">添加进度行</button>
                  </div>
                </th>
                ${headers}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function bindCourseEditorEvents() {
    els.courseEditor.querySelectorAll("[data-add-course-column]").forEach((button) => {
      button.addEventListener("click", () => addCourseColumn(button.dataset.addCourseColumn));
    });

    els.courseEditor.querySelectorAll("[data-add-course-row]").forEach((button) => {
      button.addEventListener("click", () => addCourseRow(button.dataset.addCourseRow));
    });

    els.courseEditor.querySelectorAll("[data-delete-course-column]").forEach((button) => {
      button.addEventListener("click", () => {
        const [memberId, rawIndex] = button.dataset.deleteCourseColumn.split(":");
        deleteCourseColumn(memberId, Number(rawIndex));
      });
    });

    els.courseEditor.querySelectorAll("[data-delete-course-row]").forEach((button) => {
      button.addEventListener("click", () => {
        const [memberId, rawIndex] = button.dataset.deleteCourseRow.split(":");
        deleteCourseRow(memberId, Number(rawIndex));
      });
    });

    els.courseEditor.querySelectorAll("[data-course-column-name]").forEach((input) => {
      input.addEventListener("input", () => {
        const [memberId, rawIndex] = input.dataset.courseColumnName.split(":");
        const table = ensureCourseTable(memberId);
        const column = table.columns[Number(rawIndex)];
        if (column) column.name = input.value;
      });
    });

    els.courseEditor.querySelectorAll("[data-course-row-label]").forEach((input) => {
      input.addEventListener("input", () => {
        const [memberId, rawIndex] = input.dataset.courseRowLabel.split(":");
        const table = ensureCourseTable(memberId);
        const row = table.rows[Number(rawIndex)];
        if (row) row.label = input.value;
      });
    });

    els.courseEditor.querySelectorAll("[data-course-cell]").forEach((input) => {
      input.addEventListener("input", () => {
        const [memberId, rowId, columnId] = input.dataset.courseCell.split(":");
        const row = findCourseRow(memberId, rowId);
        if (!row) return;
        row.values ||= {};
        row.values[columnId] = input.value;
      });
    });
  }

  function renderCourseHeadings() {
    state.members.forEach((member) => {
      const heading = els.courseEditor.querySelector(`[data-course-heading="${cssEscape(member.id)}"]`);
      if (heading) heading.textContent = member.name;
    });
  }

  function renderPaperEditor(section, root) {
    const rows = state.papers[section]
      .map((paper, index) => {
        const key = `${section}:${index}`;
        return `
          <tr>
            <td><input data-paper-field="${key}:title" value="${escapeAttribute(paper.title || "")}" /></td>
            <td><input data-paper-field="${key}:field" value="${escapeAttribute(paper.field || "")}" /></td>
            <td>
              <div class="file-field">
                <input data-paper-field="${key}:paperPath" value="${escapeAttribute(paper.paperPath || "")}" />
                <input data-paper-file="${key}" type="file" />
              </div>
            </td>
            <td>
              <div class="file-field">
                <input data-paper-field="${key}:notePath" value="${escapeAttribute(paper.notePath || "")}" />
                <label class="mini-label">
                  上传单个笔记文件
                  <input data-note-file="${key}" type="file" />
                </label>
                <label class="mini-label">
                  上传笔记文件夹
                  <input data-note-folder="${key}" type="file" webkitdirectory directory multiple />
                </label>
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
              <th>领域</th>
              <th>论文</th>
              <th>论文笔记</th>
              <th>阅读人</th>
              <th>阅读时间</th>
              <th>是否完成</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8" class="muted-text">暂无论文。点击上方“添加一行”。</td></tr>`}</tbody>
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
        if (input.files?.[0]) {
          delete noteFolderInputs[input.dataset.noteFile];
        }
      });
    });

    root.querySelectorAll("[data-note-folder]").forEach((input) => {
      input.addEventListener("change", () => {
        noteFolderInputs[input.dataset.noteFolder] = input.files || null;
        if (input.files?.length) {
          delete noteFileInputs[input.dataset.noteFolder];
        }
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
    state.courseTables[id] = {
      columns: [],
      rows: [],
    };
    renderAll();
  }

  function deleteMember(index) {
    const member = state.members[index];
    if (!member) return;
    state.members.splice(index, 1);
    delete state.courseTables[member.id];
    renderAll();
  }

  function addCourseColumn(memberId) {
    const table = ensureCourseTable(memberId);
    const id = uniqueId("course", table.columns.map((column) => column.id));
    table.columns.push({ id, name: `Course ${table.columns.length + 1}` });
    table.rows.forEach((row) => {
      row.values ||= {};
      row.values[id] = "";
    });
    renderAll();
  }

  function deleteCourseColumn(memberId, index) {
    const table = ensureCourseTable(memberId);
    const column = table.columns[index];
    if (!column) return;
    table.columns.splice(index, 1);
    table.rows.forEach((row) => {
      if (row.values) delete row.values[column.id];
    });
    renderAll();
  }

  function addCourseRow(memberId) {
    const table = ensureCourseTable(memberId);
    const id = uniqueId("row", table.rows.map((row) => row.id));
    const values = {};
    table.columns.forEach((column) => {
      values[column.id] = "";
    });
    table.rows.push({
      id,
      label: table.rows.length === 0 ? "当前进度" : `进度 ${table.rows.length + 1}`,
      values,
    });
    renderAll();
  }

  function deleteCourseRow(memberId, index) {
    const table = ensureCourseTable(memberId);
    table.rows.splice(index, 1);
    renderAll();
  }

  function addPaper(section) {
    state.papers[section].push({
      title: "",
      field: "",
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
      const member = state.members[Number(input.dataset.memberName)];
      if (member) member.name = input.value;
    });

    document.querySelectorAll("[data-course-column-name]").forEach((input) => {
      const [memberId, rawIndex] = input.dataset.courseColumnName.split(":");
      const column = ensureCourseTable(memberId).columns[Number(rawIndex)];
      if (column) column.name = input.value;
    });

    document.querySelectorAll("[data-course-row-label]").forEach((input) => {
      const [memberId, rawIndex] = input.dataset.courseRowLabel.split(":");
      const row = ensureCourseTable(memberId).rows[Number(rawIndex)];
      if (row) row.label = input.value;
    });

    document.querySelectorAll("[data-course-cell]").forEach((input) => {
      const [memberId, rowId, columnId] = input.dataset.courseCell.split(":");
      const row = findCourseRow(memberId, rowId);
      if (!row) return;
      row.values ||= {};
      row.values[columnId] = input.value;
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

  function ensureCourseTable(memberId) {
    state.courseTables[memberId] ||= { columns: [], rows: [] };
    state.courseTables[memberId].columns ||= [];
    state.courseTables[memberId].rows ||= [];
    state.courseTables[memberId].rows.forEach((row) => {
      row.values ||= {};
    });
    return state.courseTables[memberId];
  }

  function findCourseRow(memberId, rowId) {
    return ensureCourseTable(memberId).rows.find((row) => row.id === rowId);
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
    document.querySelectorAll(".admin-app button").forEach((button) => {
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
      courseTables: data.courseTables && typeof data.courseTables === "object" ? data.courseTables : {},
      papers: {
        shared: Array.isArray(data.papers?.shared) ? data.papers.shared : [],
        notShared: Array.isArray(data.papers?.notShared) ? data.papers.notShared : [],
      },
    };

    if (!data.courseTables) {
      const courses = Array.isArray(data.courses) ? data.courses : [];
      const progress = data.courseProgress || {};
      normalized.members.forEach((member) => {
        normalized.courseTables[member.id] = {
          columns: courses.map((course) => ({
            id: course.id,
            name: course.name || course.id,
          })),
          rows: [
            {
              id: "row-1",
              label: "当前进度",
              values: progress[member.id] || {},
            },
          ],
        };
      });
    }

    normalized.members.forEach((member, index) => {
      const existingIds = normalized.members.map((item) => item.id).filter(Boolean);
      member.id ||= uniqueId("member", existingIds, index + 1);
      member.name ||= member.id;
      normalizeCourseTable(member.id, normalized);
    });

    ["shared", "notShared"].forEach((section) => {
      normalized.papers[section] = normalized.papers[section].map((paper) => ({
        title: paper.title || "",
        field: paper.field || "",
        paperPath: paper.paperPath || "",
        notePath: paper.notePath || "",
        reader: paper.reader || "",
        readDate: paper.readDate || "",
        completed: Boolean(paper.completed),
      }));
    });

    return normalized;
  }

  function normalizeCourseTable(memberId, data) {
    data.courseTables[memberId] ||= { columns: [], rows: [] };
    const table = data.courseTables[memberId];
    table.columns = Array.isArray(table.columns) ? table.columns : [];
    table.rows = Array.isArray(table.rows) ? table.rows : [];

    table.columns.forEach((column, index) => {
      const existingIds = table.columns.map((item) => item.id).filter(Boolean);
      column.id ||= uniqueId("course", existingIds, index + 1);
      column.name ||= column.id;
    });

    table.rows.forEach((row, index) => {
      const existingIds = table.rows.map((item) => item.id).filter(Boolean);
      row.id ||= uniqueId("row", existingIds, index + 1);
      row.label ||= index === 0 ? "当前进度" : `进度 ${index + 1}`;
      row.values ||= {};
      table.columns.forEach((column) => {
        row.values[column.id] ||= "";
      });
    });
  }

  function createEmptyState() {
    return {
      members: [],
      courseTables: {},
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

  function timestampedFileName(name) {
    return `${Date.now()}-${safeFileName(name)}`;
  }

  function getFolderRootName(file) {
    const relativePath = file.webkitRelativePath || file.name || "notes-folder";
    return relativePath.split(/[\\/]+/).filter(Boolean)[0] || "notes-folder";
  }

  function sanitizeFolderRelativePath(file) {
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length > 1) {
      parts.shift();
    }
    const safeParts = (parts.length ? parts : [file.name]).map(safePathSegment).filter(Boolean);
    return safeParts.join("/");
  }

  function safePathSegment(name) {
    return safeFileName(name).replace(/^\.+$/, "file");
  }

  function folderIndexListItem(folderPath, relativePath) {
    const label = escapeHtml(relativePath);
    const href = folderIndexHref(folderPath, relativePath);
    const safeHref = escapeAttribute(href);
    const clickAction = escapeAttribute(`window.open(${JSON.stringify(href)}, "_blank", "noopener")`);
    return `<li><span>${label}</span> <button type="button" onclick="${clickAction}" style="margin-left: 0.75rem; padding: 0.25rem 0.7rem; border: 1px solid #3f51b5; border-radius: 4px; background: #3f51b5; color: #fff; cursor: pointer;">打开</button> <a href="${safeHref}" target="_blank" rel="noopener" style="margin-left: 0.5rem; font-size: 0.8em;">备用链接</a></li>`;
  }

  function folderIndexHref(folderPath, relativePath) {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const encodedParts = normalized.split("/").map(encodeURIComponent);
    if (normalized.toLowerCase().endsWith(".md")) {
      const withoutMd = encodedParts.join("/").replace(/\.md$/i, "/");
      return `${SITE_ORIGIN}/${folderPath}/${withoutMd}`;
    }
    return `${SITE_ORIGIN}/${folderPath}/${encodedParts.join("/")}`;
  }

  function safeFileName(name) {
    const clean = name
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return clean || "file";
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
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
