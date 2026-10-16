// Show the current year in the footer
document.getElementById("year").textContent = new Date().getFullYear();

// Show a message when the button is clicked
document.getElementById("helloBtn").addEventListener("click", function () {
  document.getElementById("message").textContent =
    "Hello! Thanks for visiting my GitHub Pages site 🎉";
});
