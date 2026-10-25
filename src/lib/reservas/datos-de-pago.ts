// Datos de pago de Tiza: el ÚNICO lugar donde se escriben (design 9a, decisión 9). Los pagos son simulados (PRD),
// pero estos datos son los reales del titular del proyecto: el sitio lo avisa con `AVISO_DEMOSTRACION`.
// El asistente de reserva (9b) los importa y los muestra; ningún otro archivo repite estos valores.

// Código de cuenta interbancario: 20 dígitos.
export const CCI_TIZA = "00314301327959666056";

// Titular de la cuenta, tal como aparece en el QR de Yape.
export const TITULAR_TIZA = "Jhon Alex Espichan Uscamaita";

// Imagen del QR de Yape, servida como archivo estático desde `public/pago/yape.jpeg` (copia de `yape/yape.jpeg`).
export const RUTA_QR_YAPE = "/pago/yape.jpeg";
