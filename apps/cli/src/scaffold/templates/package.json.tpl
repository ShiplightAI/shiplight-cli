{
  "name": "{{name}}",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "shiplight test",
    "test:headed": "shiplight test --headed"
  },
  "dependencies": {
    "shiplightai": "{{shiplightVersion}}"
  }
}
