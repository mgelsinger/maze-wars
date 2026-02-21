/**
 * API DOCS SCREEN
 * Static documentation for the External AI Bot API.
 */

export class ApiDocsScreen {
  constructor(app) {
    this._app = app;
    this._el  = document.getElementById('screen-apidocs');
    this._bindEvents();
  }

  show() {
    this._el.classList.add('active');
  }

  hide() {
    this._el.classList.remove('active');
  }

  _bindEvents() {
    document.getElementById('btn-apidocs-back')
      ?.addEventListener('click', () => this._app.navigate('menu'));
  }
}
