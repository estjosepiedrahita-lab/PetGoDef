window.onload = function () {
  document.getElementById("cambio").addEventListener("click", () => {
    console.log("Funcionando");
  })
}

function ajax(url) {
  const xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function () {
    console.log(xhttp.readyState);
    if (xhttp.status == 200 && xhttp.readyState == 4) {
      document.getElementById("demo").innerHTML = this.responseText;
    }
  }

  xhttp.send();
}
