import { exec } from "child_process";

export function checkJavaInstalled() {
  return new Promise((resolve) => {
    let res = "";
    exec("java -version", (error, stdout, stderr) => {


      res += stdout || "";
      res += stderr || "";

      if (error) {
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });
}





