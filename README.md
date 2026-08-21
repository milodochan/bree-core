# bree-core

内部 Bree 调度封装包。

## 安装

npm install @company/bree-core

## 使用

```js
import { Scheduler } from '@company/bree-core';

const scheduler = new Scheduler({
  jobsPath: './jobs'
});

scheduler.start();
```

## 打包

npm install
npm run build

生成 dist/index.js
