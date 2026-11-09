
function crearCookie(nombre, valor, dias) {
    const fecha = new Date();

    fecha.setTime(
        fecha.getTime() + dias * 24 * 60 * 60 * 1000
    );

    document.cookie =
        encodeURIComponent(nombre) + "=" +
        encodeURIComponent(valor) +
        "; expires=" + fecha.toUTCString() +
        "; path=/; SameSite=Lax";
}


function leerCookie(nombre) {
    const buscar = encodeURIComponent(nombre) + "=";

    const cookies = document.cookie.split("; ");

    for (let cookie of cookies) {
        if (cookie.startsWith(buscar)) {
            return decodeURIComponent(
                cookie.substring(buscar.length)
            );
        }
    }

    return null;
}


function eliminarCookie(nombre) {
    document.cookie =
        encodeURIComponent(nombre) +
        "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}


function guardarConsentimiento(aceptarAnaliticas) {

    const preferencias = {
        necesarias: true,
        analiticas: aceptarAnaliticas
    };

    crearCookie(
        "petgo_consentimiento",
        JSON.stringify(preferencias),
        180
    );

    document.getElementById("cookie-banner").remove();
}

document.addEventListener("DOMContentLoaded", function () {

    const banner = document.getElementById("cookie-banner");

    const aceptar = document.getElementById("aceptar-cookies");

    const rechazar = document.getElementById("rechazar-cookies");

    const consentimiento = leerCookie("petgo_consentimiento");

    if (consentimiento !== null) {
        banner.remove();
        return;
    }
    
    aceptar.addEventListener("click", function () {
        guardarConsentimiento(true);
    });

    // Cuando acepta solo las necesarias
    rechazar.addEventListener("click", function () {
        guardarConsentimiento(false);
    });

});
