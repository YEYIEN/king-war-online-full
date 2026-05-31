const fs = require("fs");

function buildVersion() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

const version = buildVersion();

const data = {
  version,
  updatedAt: new Date().toISOString(),
  note: "King War Online PWA version marker"
};

fs.writeFileSync(
  "client/public/version.json",
  JSON.stringify(data, null, 2),
  "utf8"
);

console.log("已更新 version.json：", version);
