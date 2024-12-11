export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BOT_TOKEN: string;
      AWS_REGION: string;
      AWS_S3_ENDPOINT: string;
      AWS_ACCESS_KEY_ID: string;
      AWS_SECRET_ACCESS_KEY: string;
      AWS_S3_BUCKET: string;
    }
  }
}
