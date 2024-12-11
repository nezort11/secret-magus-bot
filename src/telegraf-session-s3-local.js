const debug = require("debug")("telegraf:session-s3");
const AWS = require("aws-sdk");
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_S3_ENDPOINT,
});

function getS3Object(bucket, file) {
  return new Promise((resolve, reject) => {
    s3.getObject(
      {
        Bucket: bucket,
        Key: String(file),
      },
      (error, data) => {
        if (error) {
          debug("Cannot get S3 object:", error);
          if (error.code && error.code === "NoSuchKey") {
            return resolve("{}");
          }
          return reject(error);
        }

        return resolve(data.Body.toString("utf-8"));
      }
    );
  }).then((data) => JSON.parse(data));
}

function putStringToBucket(bucket, key, body) {
  return new Promise((resolve, reject) => {
    s3.putObject(
      {
        Bucket: bucket,
        Key: String(key),
        Body: Buffer.from(body, "utf-8"),
      },
      (error, data) => {
        if (error) {
          debug("Cannot put S3 object:", error);
          reject(error);
        } else {
          resolve(data);
        }
      }
    );
  });
}

function deleteS3Object(bucket, key) {
  return new Promise((resolve, reject) => {
    s3.deleteObject(
      {
        Bucket: bucket,
        Key: String(key),
      },
      (error, data) => {
        if (error) {
          debug("Cannot delete S3 object:", error);
          reject(error);
        } else {
          resolve(data);
        }
      }
    );
  });
}

export default class S3Session {
  constructor(options) {
    if (!options.bucket) {
      throw Error("S3 Bucket name not specified");
    }
    this.options = Object.assign(
      {
        property: "session",
        getSessionKey: (ctx) =>
          ctx.from && ctx.chat && `${ctx.from.id}:${ctx.chat.id}`,
        store: {},
      },
      options
    );
  }

  getSession(key) {
    return getS3Object(this.options.bucket, key);
  }

  clearSession(key) {
    debug("clear session", key);
    return deleteS3Object(this.options.bucket, key);
  }

  saveSession(key, session) {
    if (!session || Object.keys(session).length === 0) {
      return this.clearSession(key);
    }
    debug("save session", key, session);
    return putStringToBucket(
      this.options.bucket,
      key,
      JSON.stringify(session)
    );
  }

  middleware() {
    return (ctx, next) => {
      const key = this.options.getSessionKey(ctx);
      if (!key) {
        return next();
      }
      return this.getSession(key).then((session) => {
        debug("session snapshot", key, session);
        Object.defineProperty(ctx, this.options.property, {
          get: function () {
            return session;
          },
          set: function (newValue) {
            session = Object.assign({}, newValue);
          },
        });
        return next().then(() => this.saveSession(key, session));
      });
    };
  }
}

// module.exports = S3Session;
