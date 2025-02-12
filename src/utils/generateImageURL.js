require("dotenv").config();
const imgBB_api = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`;

const generateImageUrl = async (buffer, prompt) => {
  const formData = new FormData();
  formData.append(
    "image",
    new Blob([buffer], { type: "image/jpeg" }),
    `${prompt}.jpg`
  );

  const response = await fetch(imgBB_api, {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  return data;
};

module.exports = generateImageUrl;