# 编辑

<div id="admin-app" class="admin-app">
  <section class="editor-panel">
    <div class="editor-grid">
      <label>
        GitHub Token
        <input id="tokenInput" type="password" autocomplete="off" placeholder="ghp_..." />
      </label>
      <div class="editor-actions">
        <button id="openTokenButton" type="button" class="primary-button">获取 Token</button>
        <button id="saveTokenButton" type="button">保存 Token</button>
        <button id="loadRepoButton" type="button">读取仓库</button>
        <button id="saveRepoButton" type="button" class="primary-button">保存到网站</button>
      </div>
    </div>
    <p class="status-line">
      创建 Token 时，选择这个仓库，并把 Contents 权限设为 Read and write。
      <a
        id="tokenFallbackLink"
        class="inline-link"
        href="https://github.com/settings/personal-access-tokens/new?name=Agent%20Immergence%20Website%20Editor&description=Edit%20course%20progress%20and%20paper%20reading%20data%20for%20Agent%20Immergence&target_name=Agent-Immergence&expires_in=90&contents=write"
        target="_blank"
        rel="noopener noreferrer"
      >备用链接</a>
    </p>
    <p id="adminStatus" class="status-line">正在读取数据...</p>
  </section>

  <section class="editor-panel">
    <div class="panel-heading">
      <h2>成员</h2>
      <button id="addMemberButton" type="button">添加成员</button>
    </div>
    <div id="memberEditor"></div>
  </section>

  <section class="editor-panel">
    <div class="panel-heading">
      <h2>课程进度</h2>
      <span class="muted-text">每个成员一张独立表格</span>
    </div>
    <div id="courseEditor"></div>
  </section>

  <section class="editor-panel">
    <div class="panel-heading">
      <h2>Shared</h2>
      <button id="addSharedPaperButton" type="button">添加一行</button>
    </div>
    <div id="sharedPaperEditor"></div>
  </section>

  <section class="editor-panel">
    <div class="panel-heading">
      <h2>Not shared</h2>
      <button id="addPrivatePaperButton" type="button">添加一行</button>
    </div>
    <div id="privatePaperEditor"></div>
  </section>
</div>

<script src="/assets/js/admin.js"></script>
