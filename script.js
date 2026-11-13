// Constantes de configuración del comportamiento del chat
const LIMITE_CARACTERES = 500;
const TIEMPO_LIMITE_MS = 30000;
const PAUSA_MINIMA_MS = 1500;
const CLAVE_STORAGE_SESION = "chat_cocina_session_id";

// Referencias a los elementos del DOM
const contenedorMensajes = document.getElementById("mensajes-chat");
const formularioChat = document.getElementById("formulario-chat");
const entradaMensaje = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const contadorCaracteres = document.getElementById("contador-caracteres");
const estadoConexion = document.getElementById("estado-conexion");

// Variables de estado en memoria
let sesionEnMemoria = null;
let ultimoEnvioTimestamp = 0;

/**
 * Genera o recupera un identificador de sesión único para mantener el hilo en Make.
 */
function obtenerSessionId() {
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE_SESION);
    if (guardado) {
      return guardado;
    }
    const nuevoId = generarIdUnico();
    localStorage.setItem(CLAVE_STORAGE_SESION, nuevoId);
    return nuevoId;
  } catch (error) {
    if (!sesionEnMemoria) {
      sesionEnMemoria = generarIdUnico();
    }
    return sesionEnMemoria;
  }
}

/**
 * Crea un UUID v4 usando crypto.randomUUID o un respaldo seguro.
 */
function generarIdUnico() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ses-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Inicializamos el sessionId una sola vez al cargar la aplicación
const sessionId = obtenerSessionId();

/**
 * Agrega una burbuja de mensaje en la Zona de chat usando exclusivamente textContent.
 */
function agregarBurbuja(texto, tipo, esError = false) {
  const burbuja = document.createElement("div");
  burbuja.classList.add("burbuja", tipo);

  if (esError) {
    burbuja.classList.add("error");
  }

  const parrafo = document.createElement("p");
  parrafo.textContent = texto;
  burbuja.appendChild(parrafo);

  contenedorMensajes.appendChild(burbuja);
  contenedorMensajes.scrollTop = contenedorMensajes.scrollHeight;
  return burbuja;
}

/**
 * Actualiza el texto y el estilo del indicador de estado en la Zona de escritura.
 */
function actualizarEstado(mensaje, tipo = "") {
  estadoConexion.textContent = mensaje;
  estadoConexion.className = "estado-conexion";
  if (tipo) {
    estadoConexion.classList.add(tipo);
  }
}

/**
 * Habilita o deshabilita los controles de la Zona de escritura.
 */
function alternarControles(bloqueado) {
  entradaMensaje.disabled = bloqueado;
  botonEnviar.disabled = bloqueado;
}

/**
 * Verifica que la constante WEBHOOK_URL esté configurada correctamente.
 */
function webhookConfigurado() {
  if (typeof WEBHOOK_URL !== "string") return false;
  const urlLimpia = WEBHOOK_URL.trim();
  return urlLimpia !== "" && !urlLimpia.includes("ACA VA");
}

/**
 * Procesa el texto crudo devuelto por Make según las reglas del contrato.
 */
function extraerTextoRespuesta(textoCrudo) {
  if (!textoCrudo || textoCrudo.trim() === "") {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(textoCrudo);
    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      const propiedadesPrioritarias = ["response", "respuesta", "message", "mensaje"];
      for (const clave of propiedadesPrioritarias) {
        if (typeof datos[clave] === "string" && datos[clave].trim() !== "") {
          return datos[clave];
        }
      }
      return "Make respondió, pero sin el campo response";
    }
    return textoCrudo;
  } catch (error) {
    return textoCrudo;
  }
}

/**
 * Envía el mensaje al webhook de Make gestionando tiempos de espera, pausas y errores.
 */
async function enviarMensajeAlAgente(textoMensaje) {
  if (!webhookConfigurado()) {
    agregarBurbuja("Falta pegar la URL de tu webhook en config.js", "agente", true);
    actualizarEstado("Error de configuración en config.js", "error");
    return;
  }

  const ahora = Date.now();
  const tiempoTranscurrido = ahora - ultimoEnvioTimestamp;
  if (tiempoTranscurrido < PAUSA_MINIMA_MS) {
    actualizarEstado("Esperá un momento antes de enviar otro mensaje...", "error");
    return;
  }

  ultimoEnvioTimestamp = ahora;
  alternarControles(true);
  actualizarEstado("Cargando respuesta del agente...");

  agregarBurbuja(textoMensaje, "usuario");
  entradaMensaje.value = "";
  actualizarContador();

  const burbujaCargando = agregarBurbuja("Pensando recetas...", "agente");
  burbujaCargando.classList.add("cargando");

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  const cargaUtil = JSON.stringify({
    sessionId: sessionId,
    mensaje: textoMensaje,
    fecha: new Date().toISOString()
  });

  try {
    const respuesta = await fetch(WEBHOOK_URL.trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: cargaUtil,
      signal: controlador.signal
    });

    const textoServidor = await respuesta.text();
    burbujaCargando.remove();

    if (!respuesta.ok) {
      const mensajeHttp = `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`;
      agregarBurbuja(mensajeHttp, "agente", true);
      actualizarEstado(`Error HTTP ${respuesta.status}`, "error");
      return;
    }

    const textoFinal = extraerTextoRespuesta(textoServidor);
    agregarBurbuja(textoFinal, "agente");
    actualizarEstado("Respuesta recibida", "exito");
  } catch (error) {
    burbujaCargando.remove();

    if (error.name === "AbortError") {
      agregarBurbuja("Se agotó el tiempo de espera (30 segundos) sin respuesta del agente.", "agente", true);
      actualizarEstado("Tiempo límite agotado", "error");
    } else {
      agregarBurbuja("Error de red: no se pudo conectar con el servidor de Make.", "agente", true);
      actualizarEstado("Falla de conexión", "error");
    }
  } finally {
    clearTimeout(temporizador);
    setTimeout(() => {
      alternarControles(false);
      entradaMensaje.focus();
    }, PAUSA_MINIMA_MS);
  }
}

/**
 * Actualiza el contador visual de caracteres permitidos.
 */
function actualizarContador() {
  const longitud = entradaMensaje.value.length;
  contadorCaracteres.textContent = `${longitud} / ${LIMITE_CARACTERES}`;
}

// Eventos de la interfaz
entradaMensaje.addEventListener("input", actualizarContador);

entradaMensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    formularioChat.requestSubmit();
  }
});

formularioChat.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const textoLimpio = entradaMensaje.value.trim();

  if (!textoLimpio) {
    actualizarEstado("Escribí un mensaje antes de enviar.", "error");
    return;
  }

  if (textoLimpio.length > LIMITE_CARACTERES) {
    actualizarEstado(`El mensaje supera el máximo de ${LIMITE_CARACTERES} caracteres.`, "error");
    return;
  }

  enviarMensajeAlAgente(textoLimpio);
});
