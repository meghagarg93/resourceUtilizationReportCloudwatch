// index.js - CloudWatch-based ECS utilization report

const fs = require("fs");
const path = require("path");
const moment = require("moment");
const dotenv = require("dotenv");
const { CloudWatchClient, GetMetricStatisticsCommand } = require("@aws-sdk/client-cloudwatch");
const { ECSClient, ListServicesCommand, DescribeServicesCommand } = require("@aws-sdk/client-ecs");
const { generateChart, generateTaskCountChart } = require("./chartGenerator.js");
const sendEmail = require("./notify.js");
const { postToBasecamp, checkAndUpdateExpiresIn } = require("./basecamp.js");

dotenv.config();

const REGION = process.env.AWS_REGION;
const TEMPLATE_PATH = path.join(__dirname, 'reportTemplate.txt');

let ENV, DATE_ARG, SPECIFIC_SERVICES = [];
process.argv.forEach(arg => {
  if (arg.startsWith('--env=')) ENV = arg.split('=')[1];
  else if (arg.startsWith('--date=')) DATE_ARG = arg.split('=')[1];
  else if (arg.startsWith('--service=')) SPECIFIC_SERVICES = arg.split('=')[1].split(',').map(s => s.trim());
});

const CLUSTER_NAME = `dls-cup-${ENV}-apps`;
console.log(`📦 Using cluster: ${CLUSTER_NAME}`);

// ✅ Set credentials based on environment
process.env.AWS_ACCESS_KEY_ID = process.env[`AWS_ACCESS_KEY_ID_${ENV.toUpperCase()}`];
process.env.AWS_SECRET_ACCESS_KEY = process.env[`AWS_SECRET_ACCESS_KEY_${ENV.toUpperCase()}`];

const reportDate = DATE_ARG ? moment(DATE_ARG, "YYYY-MM-DD") : moment();
const today = reportDate.format("YYYY-MM-DD 10:00:00+0530");
const yesterday = reportDate.clone().subtract(1, "day").format("YYYY-MM-DD 10:00:00+0530");
const REPORT_DURATION = `${yesterday} to ${today}`;

const cloudwatch = new CloudWatchClient({ region: REGION });
const ecs = new ECSClient({ region: REGION });

// async function getServiceNames() {
//   const listCmd = new ListServicesCommand({ cluster: CLUSTER_NAME });
//   console.log("listCmd: " + JSON.stringify(listCmd))
//   const data = await ecs.send(listCmd);
//   const describeCmd = new DescribeServicesCommand({ cluster: CLUSTER_NAME, services: data.serviceArns });
//   const svcData = await ecs.send(describeCmd);
//   return svcData.services.map(svc => svc.serviceName);
// }

async function getServiceNames() {
  let serviceArns = [];
  let nextToken;

  do {
    const listCmd = new ListServicesCommand({
      cluster: CLUSTER_NAME,
      nextToken,
      maxResults: 10, // optional: defaults to 10, max 100
    });

    const data = await ecs.send(listCmd);
    serviceArns.push(...data.serviceArns);
    nextToken = data.nextToken;
  } while (nextToken);

  // Now describe all services (in batches of 10 if needed)
  const serviceNames = [];

  for (let i = 0; i < serviceArns.length; i += 10) {
    const batch = serviceArns.slice(i, i + 10);
    const describeCmd = new DescribeServicesCommand({
      cluster: CLUSTER_NAME,
      services: batch,
    });
    const svcData = await ecs.send(describeCmd);
    serviceNames.push(...svcData.services.map(svc => svc.serviceName));
  }
  console.log("Fetched service names:", serviceNames);
  return serviceNames;
}


async function getRunningTasks(service, metricName, statType) {
  const params = {
    Namespace: "ECS/ContainerInsights",
    MetricName: metricName,
    Dimensions: [
      { Name: "ClusterName", Value: CLUSTER_NAME },
      { Name: "ServiceName", Value: service }
    ],
    StartTime: new Date(yesterday), // already ISO-formatted
    EndTime: new Date(today),
    Period: 86400,
    Statistics: [statType]
  };
  console.log("StartTime: " + new Date(yesterday))
  console.log("EndTime: " + new Date(today))

  const result = await cloudwatch.send(new GetMetricStatisticsCommand(params));
  const point = result.Datapoints?.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
  return point?.[statType] || 0;
}


async function getMetricStat(service, metricName, statType) {
  const params = {
    Namespace: "AWS/ECS",
    MetricName: metricName,
    Dimensions: [
      { Name: "ClusterName", Value: CLUSTER_NAME },
      { Name: "ServiceName", Value: service }
    ],
    StartTime: new Date(yesterday), // already ISO-formatted
    EndTime: new Date(today),
    Period: 86400,
    Statistics: [statType]
  };
  const result = await cloudwatch.send(new GetMetricStatisticsCommand(params));
  const point = result.Datapoints?.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
  return point?.[statType] || 0;
}

async function getTimeseries(service, metricName) {
  const params = {
    Namespace: "AWS/ECS",
    MetricName: metricName,
    Dimensions: [
      { Name: "ClusterName", Value: CLUSTER_NAME },
      { Name: "ServiceName", Value: service }
    ],
    StartTime: new Date(yesterday), // already ISO-formatted
    EndTime: new Date(today),
    Period: 1800,
    Statistics: ["Average", "Minimum", "Maximum"]
  };
  const result = await cloudwatch.send(new GetMetricStatisticsCommand(params));
  return result.Datapoints?.map(dp => ({
    timestamp: dp.Timestamp,
    average: dp.Average || 0,
    min: dp.Minimum || 0,
    max: dp.Maximum || 0
  })) || [];
}

async function getTaskTimeseries(service, metricName) {
  const params = {
    Namespace: "ECS/ContainerInsights",
    MetricName: metricName,
    Dimensions: [
      { Name: "ClusterName", Value: CLUSTER_NAME },
      { Name: "ServiceName", Value: service }
    ],
    StartTime: new Date(yesterday),
    EndTime: new Date(today),
    Period: 900, // 30 minutes
    Statistics: ["Maximum"]
  };
  const result = await cloudwatch.send(new GetMetricStatisticsCommand(params));
  return result.Datapoints?.map(dp => ({
    timestamp: dp.Timestamp,
    value: dp.Maximum || 0
  })) || [];
}


function generateReportContent(templatePath, dataMap) {
  let template = fs.readFileSync(templatePath, 'utf-8');
  for (const key in dataMap) {
    const value = dataMap[key];
    template = template.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    template = template.replace(new RegExp(`<<\\s*${key}\\s*>>`, 'g'), value);
  }
  return template;
}

function clearOutputDir(env) {
  if (!env) {
    console.warn("⚠️ ENV is undefined; skipping output directory cleanup");
    return;
  }
  const dir = path.join(__dirname, "outputs", env);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => fs.unlinkSync(path.join(dir, file)));
    console.log(`🧹 Cleared old files in outputs/${env}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created outputs/${env} directory`);
  }
}


async function main() {
  clearOutputDir(ENV);
  try {
    let services = SPECIFIC_SERVICES.length > 0 ? SPECIFIC_SERVICES : await getServiceNames();
    const excludedApps = ["IeltsAppWeb"];
    console.log("service count: " + services.length)
    for (const service of services) {
      if (excludedApps.includes(service) && !SPECIFIC_SERVICES.includes(service)) {
        console.log(`⛔ Skipping excluded app: ${service}`);
        continue;
      }
      console.log(`\n📊 Processing: ${service}`);

      const maxTasks = await getRunningTasks(service, 'RunningTaskCount', 'Maximum');
      console.log(maxTasks);
      const maxCpu = await getMetricStat(service, 'CPUUtilization', 'Maximum');
      const maxMem = await getMetricStat(service, 'MemoryUtilization', 'Maximum');
      const avgCpu = await getMetricStat(service, 'CPUUtilization', 'Average');
      const avgMem = await getMetricStat(service, 'MemoryUtilization', 'Average');

      const cpuSeries = await getTimeseries(service, 'CPUUtilization');
      const memSeries = await getTimeseries(service, 'MemoryUtilization');
      const taskSeries = await getTaskTimeseries(service, 'RunningTaskCount');

      await generateTaskCountChart(service, 'RunningTaskCount', taskSeries, 'Running Task Count', ENV);
      await generateChart(service, 'CPUUtilization', cpuSeries, 'CPU Utilization', ENV);
      await generateChart(service, 'MemoryUtilization', memSeries, 'Memory Utilization', ENV);

      const reportData = {
        SERVICE_NAME: service,
        DATE: REPORT_DURATION,
        ECS_CLUSTER_NAME: CLUSTER_NAME,
        ENV: ENV,
        TOTAL_TASKS: maxTasks,
        AVG_CPU_UTILIZATION: avgCpu.toFixed(2),
        AVG_MEMORY_UTILIZATION: avgMem.toFixed(2),
        MAX_CPU_USAGE: maxCpu.toFixed(2),
        MAX_MEMORY_USAGE: maxMem.toFixed(2)
      };

      const reportText = generateReportContent(TEMPLATE_PATH, reportData);
      const reportPath = path.join(__dirname, 'outputs', ENV, `report_${service}.txt`);
      fs.writeFileSync(reportPath, reportText);
      console.log(`✅ Report written to ${reportPath}`);

      try { await sendEmail(0, ENV, service); } catch (err) {
        console.error(`❌ Failed to send email for ${service}:`, err.message);
      }

      await postToBasecamp(service, ENV);
    }
  } catch (err) {
    console.error('❌ Error:', err);
    await sendEmail(1);
  }
}

main();
