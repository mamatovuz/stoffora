import { Linking } from "react-native";
import { post } from "./api";
import { SERVER_ORIGIN } from "./config";

/**
 * Fayl (hisob varaqa, hujjat): server qisqa muddatli bir martalik havola beradi —
 * doimiy token URL’ga qo‘yilmaydi. Havola tizim brauzerida/ko‘rish dasturida ochiladi.
 */
export async function openFile(body: { kind: "payslip"; month: string } | { kind: "document"; id: string }) {
  const { path } = await post<{ path: string; fileName: string }>("/mini/download", body);
  await Linking.openURL(SERVER_ORIGIN + path);
}
