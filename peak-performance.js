const fs = require('fs');

function processLogFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const stats = {
    'Write': {},
    'Read': {},
    'Stat': {},
    'Remove': {}
  };

  let currentOperation = null;

  for (const line of lines) {
    const operationMatch = line.match(/(Write|Read|Stat|Remove): scheduling/);
    const opsMatch = line.match(/(\d{2}:\d{2}:\d{2}): (Write|Read|Stat|Remove): Ops (\d+\.\d+)\/s/);

    if (operationMatch) {
      currentOperation = operationMatch[1];
    }

    if (opsMatch) {
      const timestamp = opsMatch[1];
      const operation = opsMatch[2];
      const ops = parseFloat(opsMatch[3]);

      if (!stats[operation][timestamp]) {
        stats[operation][timestamp] = 0;
      }

      stats[operation][timestamp] += ops;
    }
  }

  return stats;
}

function approximateMissingSeconds(stats) {
  for (const operation in stats) {
    const sortedTimes = Object.keys(stats[operation]).sort();
    for (let i = 1; i < sortedTimes.length; i++) {
      const prevTime = sortedTimes[i - 1];
      const currentTime = sortedTimes[i];
      const prevSeconds = parseInt(prevTime.split(':')[2]);
      const currentSeconds = parseInt(currentTime.split(':')[2]);

      // If there is a missing second between timestamps
      if (currentSeconds - prevSeconds > 1) {
        const approxOps = (stats[operation][prevTime] + stats[operation][currentTime]) / 2;
        const missingSecond = `${currentTime.slice(0, -2)}${String(prevSeconds + 1).padStart(2, '0')}`;
        stats[operation][missingSecond] = approxOps;
      }
    }
  }
}

function summarizePeakPerformance(logFiles) {
  const summaryStats = {
    'Write': {},
    'Read': {},
    'Stat': {},
    'Remove': {}
  };

  for (const filePath of logFiles) {
    const stats = processLogFile(filePath);

    for (const operation in stats) {
      for (const timestamp in stats[operation]) {
        if (!summaryStats[operation][timestamp]) {
          summaryStats[operation][timestamp] = 0;
        }

        summaryStats[operation][timestamp] += stats[operation][timestamp];
      }
    }
  }

  // Approximate missing seconds
  approximateMissingSeconds(summaryStats);

  // Calculate the peak performance
  const peakPerformance = {};
  for (const operation in summaryStats) {
    let maxOps = 0;
    for (const timestamp in summaryStats[operation]) {
      maxOps = Math.max(maxOps, summaryStats[operation][timestamp]);
    }
    peakPerformance[operation] = maxOps;
  }

  return peakPerformance;
}

// Example usage
const [,,...logFiles] = process.argv;

const peakPerformance = summarizePeakPerformance(logFiles);
console.log('Peak Performance:', peakPerformance);