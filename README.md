# Secret magnus bot

Go to yandex cloud dashboard and create a service user with s3 access:

- Настраивать ~/.aws/config и ~/.aws/credentials для Yandex Cloud - не нужно (работает и без этого)

- Главное при создании сервисного аккаунта выбрать: `admin`, `editor`, `viewer` и все другие!! (иначе будет AccessDenied)

- volta
- nodejs
- telegraf framework
- serverless framework
- serverless-http
- yandex-cloud-serverless-plugin

## Setup

- install [volta](https://docs.volta.sh/guide/getting-started)

- install [yc cli](https://yandex.cloud/ru/docs/cli/quickstart)

```sh
git clone https://github.com/nezort11/telegraf-serverless-yandex-cloud-template.git your-project-name
rm -rf ./your-project-name/.git

volta install node@18
pnpm install

# Start development server
pnpm dev
```

## Deploy

```sh
pnpm release

# or

pnpm build
pnpm serverless:deploy
pnpm serverless:info
pnpm webhook:set
```

Clear resource and reset

```sh
pnpm purge
pnpm webhook:remove
```
