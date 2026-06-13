(function () {
  const DATA_URL = "/assets/data/site-data.json";

  document.addEventListener("DOMContentLoaded", async () => {
    const courseRoot = document.getElementById("course-progress-app");
    const paperRoot = document.getElementById("paper-reading-app");

    if (!courseRoot && !paperRoot) {
      return;
    }

    try {
      const data = await loadData();
      if (courseRoot) {
        renderCourseProgress(courseRoot, data);
      }
      if (paperRoot) {
        renderPaperReading(paperRoot, data);
      }
    } catch (error) {
      const message = `<p class="muted-text">数据读取失败：${escapeHtml(error.message)}</p>`;
      if (courseRoot) courseRoot.innerHTML = message;
      if (paperRoot) paperRoot.innerHTML = message;
    }
  });

  async function loadData() {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  function renderCourseProgress(root, data) {
    const members = Array.isArray(data.members) ? data.members : [];
    const courseTables = getCourseTables(data);

    if (members.length === 0) {
      root.innerHTML = `<p class="muted-text">暂无课程进度。</p>`;
      return;
    }

    root.innerHTML = members
      .map((member) => {
        const table = courseTables[member.id] || { columns: [], rows: [] };
        const columns = Array.isArray(table.columns) ? table.columns : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const headers = columns.map((course) => `<th>${escapeHtml(course.name)}</th>`).join("");
        const body = rows.length
          ? rows
              .map((row) => {
                const cells = columns
                  .map((course) => `<td>${escapeHtml(row.values?.[course.id] || "")}</td>`)
                  .join("");
                return `
                  <tr>
                    <td>${escapeHtml(row.label || "")}</td>
                    ${cells}
                  </tr>
                `;
              })
              .join("")
          : `<tr><td colspan="${columns.length + 1}" class="muted-text">暂无课程进度。</td></tr>`;

        return `
          <section class="tracker-section">
            <h2>${escapeHtml(member.name)}</h2>
            <div class="tracker-table-wrap">
              <table class="tracker-table">
                <thead>
                  <tr>
                    <th>进度</th>
                    ${headers}
                  </tr>
                </thead>
                <tbody>${body}</tbody>
              </table>
            </div>
          </section>
        `;
      })
      .join("");
  }

  function getCourseTables(data) {
    if (data.courseTables && typeof data.courseTables === "object") {
      return data.courseTables;
    }

    const tables = {};
    const courses = Array.isArray(data.courses) ? data.courses : [];
    const progress = data.courseProgress || {};
    const members = Array.isArray(data.members) ? data.members : [];

    members.forEach((member) => {
      tables[member.id] = {
        columns: courses,
        rows: [
          {
            id: "row-1",
            label: "当前进度",
            values: progress[member.id] || {},
          },
        ],
      };
    });

    return tables;
  }

  function renderPaperReading(root, data) {
    const papers = data.papers || {};
    root.innerHTML = `
      ${renderPaperTable("Shared", papers.shared || [])}
      ${renderPaperTable("Not shared", papers.notShared || [])}
    `;
  }

  function renderPaperTable(title, rows) {
    const body = rows.length
      ? rows
          .map(
            (paper) => `
              <tr>
                <td>${escapeHtml(paper.title || "")}</td>
                <td>${renderFileLink(paper.paperPath, "论文")}</td>
                <td>${renderFileLink(paper.notePath, "论文笔记")}</td>
                <td>${escapeHtml(paper.reader || "")}</td>
                <td>${escapeHtml(paper.readDate || "")}</td>
                <td>${renderDone(paper.completed)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="6" class="muted-text">暂无记录。</td></tr>`;

    return `
      <section class="tracker-section">
        <h2>${escapeHtml(title)}</h2>
        <div class="tracker-table-wrap">
          <table class="tracker-table">
            <thead>
              <tr>
                <th>论文名称</th>
                <th>论文</th>
                <th>论文笔记</th>
                <th>阅读人</th>
                <th>阅读时间</th>
                <th>是否完成</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderFileLink(path, label) {
    if (!path) {
      return `<span class="muted-text">未上传</span>`;
    }
    const url = toPublicUrl(path);
    return `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  }

  function renderDone(done) {
    const className = done ? "done" : "todo";
    const text = done ? "已完成" : "未完成";
    return `<span class="status-pill ${className}">${text}</span>`;
  }

  function toPublicUrl(path) {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    let normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    normalized = normalized.replace(/^docs\//, "");

    if (normalized.endsWith("/index.md")) {
      normalized = normalized.slice(0, -"index.md".length);
    } else if (normalized.endsWith(".md")) {
      normalized = normalized.slice(0, -".md".length) + "/";
    }

    return `/${encodeURI(normalized)}`;
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
