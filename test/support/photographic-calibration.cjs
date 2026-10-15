const Zip = require("../../vendor/jszip.min.js");
async function photographicFixture(
  page,
  { blocked = false, double = false, occluded = false } = {},
) {
  const images = await page.evaluate(
    ({ blocked, double, occluded }) => {
      const corners = double
          ? [-1.1, 1.1].flatMap((cx) => [
              [cx - 0.65, 1, -4],
              [cx + 0.65, 1, -4],
              [cx + 0.65, -1, -4],
              [cx - 0.65, -1, -4],
            ])
          : [
              [-0.9, 1, -4],
              [0.9, 1, -4],
              [0.9, -1, -4],
              [-0.9, -1, -4],
            ],
        poses = [
          { C: [0, 0, 0], yaw: 0 },
          { C: [0.8, 0.05, 0.15], yaw: 12 },
        ];
      const images = poses.map((pose, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d"),
          image = ctx.createImageData(canvas.width, canvas.height),
          ca = Math.cos((pose.yaw * Math.PI) / 180),
          sa = Math.sin((pose.yaw * Math.PI) / 180);
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            const theta = ((y + 0.5) / canvas.height) * Math.PI,
              phi = ((x + 0.5) / canvas.width) * 2 * Math.PI,
              lx = Math.cos(phi) * Math.sin(theta),
              ly = Math.cos(theta),
              lz = Math.sin(phi) * Math.sin(theta),
              dx = ca * lx + sa * lz,
              dz = -sa * lx + ca * lz,
              t = (-4 - pose.C[2]) / dz,
              wx = pose.C[0] + t * dx,
              wy = pose.C[1] + t * ly,
              v =
                index === 1 && (blocked || (occluded && wx > 0))
                  ? 90
                  : t > 0 &&
                      (double
                        ? Math.abs(wx - 1.1) <= 0.65 ||
                          Math.abs(wx + 1.1) <= 0.65
                        : Math.abs(wx) <= 0.9) &&
                      Math.abs(wy) <= 1
                    ? double
                      ? 170 +
                        ((((Math.floor((wx + 3) * 25) * 73856093) ^
                          (Math.floor((wy + 2) * 25) * 19349663)) >>>
                          0) %
                          70)
                      : 238
                    : 30,
              i = (y * canvas.width + x) * 4;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
            image.data[i + 3] = 255;
          }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL("image/png");
      });
      const bearings = poses.map((pose) =>
        corners.map((p) => {
          const dx = p[0] - pose.C[0],
            dy = p[1] - pose.C[1],
            dz = p[2] - pose.C[2],
            a = (pose.yaw * Math.PI) / 180;
          return PalaceCalibrationMath.angles([
            Math.cos(a) * dx - Math.sin(a) * dz,
            dy,
            Math.sin(a) * dx + Math.cos(a) * dz,
          ]);
        }),
      );
      return { images, bearings };
    },
    { blocked, double, occluded },
  );
  const zip = new Zip();
  images.images.forEach((url, i) =>
    zip.file(`p${i}.png`, url.split(",")[1], { base64: true }),
  );
  zip.file(
    "palace.json",
    JSON.stringify({
      name: "Guided corners",
      levels: [],
      panoramas: {
        a: { mode: "equirect", file: "p0.png", room: "Reference" },
        b: { mode: "equirect", file: "p1.png", room: "Connecting" },
      },
    }),
  );
  await page
    .locator("#fileOpen")
    .setInputFiles({
      name: "guided.mpalace",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    });
  await page.waitForFunction(
    () => archiveContext?.name === "guided.mpalace" && !calibrationUI.importing,
  );
  return images.bearings;
}

module.exports = { photographicFixture };
