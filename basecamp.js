const fs = require("fs");
const path = require("path");
const axios = require("axios");
const moment = require("moment");
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");
// const data = require("./params.js");

dotenv.config();
const secretKey = process.env.SECRET_KEY;

const encryptedclientId = "U2FsdGVkX1/NvoGhZPkYjP2FcrUErmI/OFS5HOH3OMDdj64Agm1nUejs0iyKh4OySL6xYyzm291i2kMGS5gWZQ==";
const encryptedclientSecret = "U2FsdGVkX19fg2Z9UgfmKxsQi7FXA0hYhXWtzwx2UbHnQGdEROEFryy05VNnpoK2mfBJHeMVkPLxAwO05kBbFA==";

async function getAccessTokenFromRefreshToken() {
  const refreshToken = "BAhbB0kiAbB7ImNsaWVudF9pZCI6IjY3NjZlYmFiM2E1Y2ZhOTAwOTI0MjM1OTNjNjZlZjQ3NzMwN2Y3ZmIiLCJleHBpcmVzX2F0IjoiMjAzNS0wNi0yNlQwNzoxMTo1NloiLCJ1c2VyX2lkcyI6WzQxOTY0MjM2XSwidmVyc2lvbiI6MSwiYXBpX2RlYWRib2x0IjoiNzA0OGJjYmU2OGJkZWViN2QyODc0YzBkNjkyNDAyZjcifQY6BkVUSXU6CVRpbWUNR9chwI9EjS8JOg1uYW5vX251bWkCrAI6DW5hbm9fZGVuaQY6DXN1Ym1pY3JvIgdoQDoJem9uZUkiCFVUQwY7AEY=--3c2cbe3027ef1718dd64c47db58f136fe54e4179";
  const clientId = CryptoJS.AES.decrypt(encryptedclientId, secretKey).toString(CryptoJS.enc.Utf8);
  const clientSecret = CryptoJS.AES.decrypt(encryptedclientSecret, secretKey).toString(CryptoJS.enc.Utf8);

  try {
    const response = await axios.post("https://launchpad.37signals.com/authorization/token", {
      type: "refresh",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    return response.data.access_token;
  } catch (error) {
    console.error("❌ Failed to fetch access token from refresh token:", error.response?.data || error.message);
    throw error;
  }
}

async function uploadImage(filePath, accessToken) {
  try {
    const fileData = fs.readFileSync(filePath);
    const url = "https://3.basecampapi.com/4489886/attachments.json?name=chart.png";

    const response = await axios.post(url, fileData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/png",
      },
    });

    return response.data.attachable_sgid;
  } catch (error) {
    console.error(`❌ Error uploading image ${filePath}:`, error.message);
    return null;
  }
}

async function postToBasecamp(service, env) {
  const accessToken = await getAccessTokenFromRefreshToken();
  const getThreadId = (service) => process.env[`BASECAMP_THREAD_${service}`];
  const getProjectId = (env) => process.env[`BASECAMP_PROJECT_${env}`];

  const projectId = getProjectId(env);
  const threadId = getThreadId(service);

  if (!threadId) {
    console.warn(`⚠️ No Basecamp thread mapping found for ${service}`);
    return;
  }

  const cpuPath = `./outputs/${env}/${service}_${env}_cpuutilization_chart.png`;
  const memPath = `./outputs/${env}/${service}_${env}_memoryutilization_chart.png`;
  const reportPath = `./outputs/${env}/report_${service}.txt`;

  const cpuSGID = await uploadImage(cpuPath, accessToken);
  const memSGID = await uploadImage(memPath, accessToken);

  if (!cpuSGID || !memSGID) {
    console.warn(`⚠️ One or more attachments failed for ${service}`);
    return;
  }

  // Replace chart links in the report
  let content = fs.readFileSync(reportPath, "utf-8");
  content = content.replace("<<cpu_chart_link>>", cpuSGID);
  content = content.replace("<<memory_chart_link>>", memSGID);
  fs.writeFileSync(reportPath, content);

  const url = `https://3.basecampapi.com/4489886/buckets/${projectId}/recordings/${threadId}/comments.json`;
  console.log(url);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`
  };

  try {
    const body = { content };
    await axios.post(url, body, { headers });
    console.log(`📬 Posted to Basecamp thread for ${service}`);
  } catch (error) {
    console.error(`❌ Failed to post Basecamp comment for ${service}:`, error.message);
  }
}

module.exports = {
  postToBasecamp
};
