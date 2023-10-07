require('dotenv').config();

const numString = process.argv[2];
const threadsString = process.argv[3];
if (process.argv.length < 2) {
  console.warn('node r2-benchmark.js <number of objects> <number of threads>');
  process.exit(1);
}

const benchmarkCount = parseInt(numString);
const threads = parseInt(threadsString);

function randomIntFromInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { Agent: HttpsAgent } = require('https');
const { Agent: HttpAgent } = require('http');

const { NodeHttpHandler } = require('@aws-sdk/node-http-handler');
const crypto = require('crypto');

// https://github.com/aws/aws-sdk-net/issues/815#issuecomment-352466303
function stripEtag(quotedEtag) {
  return quotedEtag.replaceAll(/"/g, '');
}

const isNotFound = (err) => err.name === 'NotFound' || err.name === 'NoSuchKey';

const MAXIMUM_ATTEMPTS = 20;
const DELAY_RATIO = 1000;

const { StandardRetryStrategy } = require('@smithy/util-retry');

const standardRetryStrategy = new StandardRetryStrategy(
  MAXIMUM_ATTEMPTS,
  {
    retryDecider: error => {
      if (isNotFound(error)) return false;
      return true;
    },
    delayDecider: (_delayBase, attempts) => {
      return DELAY_RATIO * attempts;
    },
  },
);

standardRetryStrategy.mode = 'STANDARD';

const createDefaultRetryToken = ({
  retryDelay,
  retryCount,
  retryCost,
}) => {
  const getRetryCount = () => retryCount;
  const getRetryDelay = () => 1000;
  const getRetryCost = () => retryCost;

  return {
    getRetryCount,
    getRetryDelay,
    getRetryCost,
  };
};

class CustomRetryStrategy extends StandardRetryStrategy {
  totalRetryCount = 0;

  async acquireInitialRetryToken(retryTokenScope) {
    return createDefaultRetryToken({
      retryDelay: 1000,
      retryCount: 0,
    });
  }

  shouldRetry(token, errorInfo, maxAttempts) {
    if (errorInfo?.['$metadata']?.httpStatusCode === 404) {
      return false;
    }

    if (errorInfo.errorType === 'SERVER_ERROR' || errorInfo.errorType === 'TRANSIENT' || errorInfo.errorType === 'CLIENT_ERROR') {
      console.log(`Retrying on ${errorInfo.errorType} error`);
      return true;
    }

    if (errorInfo.code === 'EADDRNOTAVAIL' || errorInfo.code === 'ECONNRESET' || [522, 500].includes(errorInfo?.['$metadata']?.httpStatusCode)) {
      console.log('Recovering from error', errorInfo);
      return true;
    }
    

    const res =  super.shouldRetry(token, errorInfo, maxAttempts);
    if (res) {
      console.log('Recovering from error', errorInfo);
    }
    return res;
  }

  async refreshRetryTokenForRetry(token, errorInfo) {
    const maxAttempts = await this.getMaxAttempts();

    if (this.shouldRetry(token, errorInfo, maxAttempts)) {
      this.totalRetryCount += 1;
      return createDefaultRetryToken({
        retryDelay: 1000,
        retryCount: token.getRetryCount() + 1,
        retryCost: 0,
      });
    }

    throw new Error("No retry token available");
  }
}


class S3StorageClient {
  constructor(clientOptions, bucketName) {
    this.bucketName = bucketName;
    this.clientOptions = clientOptions;


    this.retryStrategy = new CustomRetryStrategy(MAXIMUM_ATTEMPTS);
    
    this.s3Client = new S3Client({
      ...this.clientOptions,
      maxAttempts: MAXIMUM_ATTEMPTS,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        // socketTimeout is VERY important, this is how long to wait for a request. If more than 2000 assume it has failed and needs retrying
        socketTimeout: 3000,
        httpsAgent: this.httpsAgent,
        httpAgent: this.httpAgent,
      }),
      retryStrategy: this.retryStrategy,
      // retryStrategy: new StandardRetryStrategy(MAXIMUM_ATTEMPTS),
      // retryStrategy: new ConfiguredRetryStrategy(
      //   4, // max attempts.
      //   (attempt) => 100 + attempt * 1000 // backoff function.
      // ),
    });
    // console.log(this.s3Client);
  }

  httpsAgent = new HttpsAgent({
    maxSockets: 10000,
    maxCachedSessions: 10000,
    keepAlive: true,
  });

  httpAgent = new HttpAgent({
    maxSockets: 10000,
    keepAlive: true,
  });

  async storeObject(objectName, stream, mimetype) {
    const contentType = mimetype || 'application/octet-stream';

    let bufferOrString;
    if (!Buffer.isBuffer(stream) && typeof stream !== 'string') {
      const chunks = [];
      for await (let chunk of stream) {
        chunks.push(chunk);
      }
      bufferOrString = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    } else {
      bufferOrString = stream;
    }
    const data = await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectName,
      Body: bufferOrString,
      ContentType: contentType,
      ContentLength: bufferOrString.length,
    }));
    if (!data.ETag) {
      throw new Error('Expected to get ETag from the S3Client');
    }
    return {
      etag: stripEtag(data.ETag),
      size: bufferOrString.length,
    };
  }

  async statObject(objectName) {
    try {
      const headResult = await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: objectName,
      }));
      const etag = stripEtag(headResult.ETag);
      const lastModified = headResult.LastModified;
      const size = headResult.ContentLength;
      return { etag, lastModified, size };
    } catch (err) {
      if (isNotFound(err)) {
        throw new NotFoundError(`Not found: ${objectName}`);
      }
      throw err;
    }
  }

  async getObject(objectName) {
    try {
      const { Body, ETag, ContentLength, LastModified } = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectName,
      }));
      return {
        stream: Body,
        stat: {
          etag: stripEtag(ETag),
          size: ContentLength,
          lastModified: LastModified,
        },
      };
    } catch (err) {
      if (isNotFound(err)) {
        throw new NotFoundError(`Not found: ${objectName}`);
      }
      throw err;
    }
  }

  async removeObject(objectName) {
    await this.s3Client.send(new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: objectName,
    }));
  }

  async copyObject(dstObjectName, srcObjectName) {
    try {
      await this.s3Client.send(new CopyObjectCommand({
        Bucket: this.bucketName,
        Key: dstObjectName,
        CopySource: `${this.bucketName}/${srcObjectName}`,
      }));
    } catch (err) {
      if (isNotFound(err)) {
        throw new NotFoundError(`Not found: ${srcObjectName}`);
      }
      throw err;
    }
  }
}

const rushId = () => crypto.randomBytes(16).toString("hex");

const { S3_USE_SSL = '1', S3_HOSTNAME, S3_PORT = '443', S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, DEBUG } = process.env;
process.env.AWS_REGION='auto';

const buckets = S3_BUCKET.split(',');

const createObjectStorageClient = (bucket) => new S3StorageClient({
  region: 'auto',
  disableHostPrefix: true,
  forcePathStyle: true,
  endpoint: `${S3_USE_SSL ? `https://` : `http://`}${S3_HOSTNAME}:${S3_PORT ? +S3_PORT : 9000}`,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
}, bucket);

const objectStorageClients = Array.from(Array(buckets.length).keys()).map((i) => createObjectStorageClient(buckets[i % buckets.length]));

const formatBytesToMB = byteSize => (byteSize / 1024 / 1024).toFixed(1);

async function main() {
  const objects = {};
  const objectsByNum = [];

  const writeObject = async (threadNum, objectNum) => {
    const name = `benchmark/${rushId()}.png`;
    const objectStorage = objectStorageClients[threadNum % objectStorageClients.length];
    const buf = crypto.pseudoRandomBytes(randomIntFromInterval(4096 * 4, 4096 * 4));
    const { etag, size } = await objectStorage.storeObject(name, buf);
    objectsByNum[objectNum] = objects[name] = { etag, size, objectStorage, name };
    return { size };
  };

  const readObject = async (threadNum, objectNum) => {
    const { name, etag, objectStorage } = objectsByNum[objectNum];
    let downloadedEtag, size, stream;
    let downloadedSize = 0;

    let wasError;
    for (let i = 0; i < MAXIMUM_ATTEMPTS; ++i) {
      try {
        wasError = undefined;
        ({ stat: { etag: downloadedEtag, size }, stream } = await objectStorage.getObject(name));
        downloadedSize = 0;
        for await (const buf of stream) {
          downloadedSize += buf.length;
        }
        break;
      } catch (err) {
        console.error(`Error during reading (${err.message}), retrying for the ${i+1} time`);
        wasError = err;
        if (i < MAXIMUM_ATTEMPTS) {
          objectStorage.retryStrategy.totalRetryCount += 1; // leverage the same counter for simplicity
        }
      }
    }
    if (wasError) {
      throw wasError;
    }

    if (etag !== downloadedEtag || size !== downloadedSize) {
      throw new Error(`Check failed for ${name}: size ${size} == ${downloadedSize} : etag ${etag} == ${downloadedEtag}`);
    }

    return { size };
  };


  const statObject = async (threadNum, objectNum) => {
    const { name, etag, objectStorage, size } = objectsByNum[objectNum];
    const { etag: downloadedEtag, size: downloadedSize } = await objectStorage.statObject(name);

    if (etag !== downloadedEtag || size !== downloadedSize) {
      throw new Error(`Check failed for ${name}: size ${size} == ${downloadedSize} : etag ${etag} == ${downloadedEtag}`);
    }

    return { size };
  };

  const removeObject = async (threadNum, objectNum) => {
    const { name, objectStorage, size } = objectsByNum[objectNum];
    await objectStorage.removeObject(name);

    return { size };
  };


  const getCurrentTime = () => performance.now();

  const getUTCTimeString = () => {
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  
    return `${hours}:${minutes}:${seconds}`;
  }

  const runBenchmark = async (opName, operationFunction) => {
    const startTime = Date.now();
    const promises = [];
    console.log(`${opName}: scheduling for ${benchmarkCount} objects in ${threads} threads and ${objectStorageClients.length} buckets`);
    
    let threadsCounters = { count: [], totalSize: [] }
    let lastState = {count: 0, totalSize: 0, time: getCurrentTime()};
    let peakOps = 0;
    const handle = setInterval(() => {
      const currentTime = getCurrentTime();
      const newCount = threadsCounters.count.reduce((acc, i) => acc + i, 0);
      const newTotalSize = threadsCounters.totalSize.reduce((acc, i) => acc + i, 0);
      const elapsedTime = currentTime - lastState.time;
      const currentOps = ((newCount - lastState.count)/elapsedTime*1000);
      console.log(`${getUTCTimeString()}: ${opName}: Ops ${currentOps.toFixed(1)}/s Throughput ${(formatBytesToMB((newTotalSize - lastState.totalSize)/elapsedTime*1000))}MB/s`, );
      if (currentOps > peakOps) { peakOps = currentOps; }
      lastState.totalSize = newTotalSize;
      lastState.count = newCount;
      lastState.time = currentTime;
    }, 1000);

    let currentBenchmarkCount = benchmarkCount;

    for (let threadId = 0; threadId < threads; ++threadId) {
      promises.push((async () => {
        while (currentBenchmarkCount) {
          currentBenchmarkCount--;
          const { size } = await operationFunction(threadId, currentBenchmarkCount);
          threadsCounters.count[threadId] = (threadsCounters.count[threadId] || 0) + 1;
          threadsCounters.totalSize[threadId] = (threadsCounters.totalSize[threadId] || 0) + size;
        }
        return threadsCounters.totalSize[threadId];
      })());
    }

    const totalSize = (await Promise.all(promises)).reduce((acc, size) => {
      return acc + size;
    }, 0);
    clearInterval(handle);
    const tookTime = Date.now() - startTime; 
    const totalRetryCount = objectStorageClients.reduce((acc, storageClient) => acc + storageClient.retryStrategy.totalRetryCount, 0);

    console.log(`${opName} took ${tookTime}ms. Peak ops ${peakOps.toFixed(1)}/s Avg ops ${(benchmarkCount / (tookTime / 1000)).toFixed(1)}/s  Total size ${(formatBytesToMB(totalSize))}MB  Recoverable errors ${totalRetryCount}`);

    objectStorageClients.forEach(storageClient => { storageClient.retryStrategy.totalRetryCount = 0; });
  }

  await runBenchmark('Write', writeObject);
  await runBenchmark('Read', readObject);
  await runBenchmark('Stat', statObject);
  await runBenchmark('Remove', removeObject);
}

main();
