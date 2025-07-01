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
const encryptedrefreshToken = "U2FsdGVkX1/Bre16n6FlFrJXWuKNw7ZrGEViWogbEEroasznd7/eMe3CX2l07ArlBXxun+CGqCGK0YJY/yrQ6MST69/haVtixckQURWwyJIBUWIR+S08a3JcAzVQqz77wM2HSzg2zIsmvYsMH4yWtcZ501E6NP1RJzoLD9xWDsAmeYb6OC+5iSypsFEQRw26dZ9Mp8wvnSKFieK2bQcosdrCcTF6UW2g2dR5l3qMx1LPiyX7HUoK07jEfL0ULSkN8jFCoFFHCNY3eY3lMsafEPfD/0nhTAMHDJCB5YOUBoy3sNACThXT088Z6AhUvHzr2Q/1MWcAkRzKin9FrU9UwYqnpiRr+RxB++s3voMt3Ow5t/KTRS4q2Sahf3ZZ9VLH14Uu7PoxF1qpLUJD+PdTs41+xe7iWyLKOKbBZKA8BiWWaBUxiRhDt50DL+Y0qRzsUhyJ5Wi/n/58FodmJPRPqqtIYbvFluvf2suDJx04O5GD178ltWmp+pcfhka1/8BodZO+jYqekMGsOvUoMpv4yiOuULPNoQ4NQHVv058o/2Q=";

async function getAccessTokenFromRefreshToken() {
  const refreshToken = CryptoJS.AES.decrypt(encryptedrefreshToken, secretKey).toString(CryptoJS.enc.Utf8);
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
  console.log("accessToken: " + accessToken);
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
