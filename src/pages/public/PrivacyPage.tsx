import { Link } from "react-router-dom";
import { LegalDocument, LegalHero, PublicLayout, usePublicMeta } from "./PublicLayout";

const sections = [
  {
    id: "general",
    title: "Umumiy ma’lumot",
    content: (
      <>
        <p>Ushbu Maxfiylik siyosati Staffora veb-platformasi, Telegram Mini App hamda iOS va Android ilovalarida shaxsga doir ma’lumotlar qanday qayta ishlanishini tushuntiradi. Staffora tashkilotlarga xodimlar, davomat va tegishli HR jarayonlarini boshqarish imkonini beruvchi dasturiy platformadir.</p>
        <p>Platformadan tashkilot nomidan foydalanilganda, xodim ma’lumotlarini qayta ishlash maqsadlari va vakolatlarini odatda tegishli ish beruvchi belgilaydi. Staffora ma’lumotlarni platformani taqdim etish, uning xavfsiz ishlashini ta’minlash va foydalanuvchi so‘rovlarini bajarish doirasida qayta ishlaydi.</p>
      </>
    ),
  },
  {
    id: "about",
    title: "Staffora haqida",
    content: <p>Staffora kompaniya administratorlari, rahbarlar va xodimlarga rollariga mos funksiyalarni taqdim etadi. Jumladan, xodimlar ro‘yxati, filial va ish jadvali, davomat, ta’til va xizmat so‘rovlari, bildirishnomalar, hisobotlar hamda kompaniya sozlamalari boshqarilishi mumkin.</p>,
  },
  {
    id: "data",
    title: "Qanday ma’lumotlarni yig‘amiz?",
    content: (
      <>
        <p>Foydalaniladigan funksiyalar va tashkilot sozlamalariga qarab quyidagi ma’lumotlar qayta ishlanishi mumkin:</p>
        <ul>
          <li><strong>Shaxsiy va aloqa ma’lumotlari:</strong> ism, familiya, telefon raqami, elektron pochta manzili, lavozim, bo‘lim, filial va profil rasmi.</li>
          <li><strong>Akkaunt ma’lumotlari:</strong> foydalanuvchi roli, kompaniyaga mansublik, kirish sessiyalari va akkaunt holati.</li>
          <li><strong>Davomat ma’lumotlari:</strong> kelish-ketish vaqti, ish jadvali, kechikish, ishlangan vaqt, tasdiqlash usuli va tegishli tarix.</li>
          <li><strong>Joylashuv:</strong> davomatni filial hududida tasdiqlash talab qilinganda, foydalanuvchi ruxsati bilan olingan koordinata, aniqlik va filialdan masofa.</li>
          <li><strong>Kamera va yuzni tasdiqlash:</strong> kompaniya yoqqan bo‘lsa, davomat paytidagi tasvir va shaxsni moslashtirish uchun hisoblangan yuz shabloni. Qurilmaning tizim biometriyasi Staffora serveriga berilmaydi.</li>
          <li><strong>Qurilma va texnik ma’lumotlar:</strong> qurilma turi, operatsion tizim, ilova versiyasi, ochiq kriptografik kalit, push-token, IP manzil, xatolik va xavfsizlik jurnallari.</li>
          <li><strong>Foydalanuvchi yuborgan ma’lumotlar:</strong> ta’til yoki boshqa so‘rovlar, izohlar, biriktirilgan fayllar, yordam murojaatlari va kompaniya yoqqan moliyaviy funksiyalardagi ma’lumotlar.</li>
        </ul>
        <p>Staffora IMEI yoki MAC manzilni maqsadli ravishda yig‘maydi. Kamera va joylashuv fonda doimiy kuzatuv uchun ishlatilmaydi.</p>
      </>
    ),
  },
  {
    id: "purposes",
    title: "Ma’lumotlardan foydalanish maqsadi",
    content: (
      <ul>
        <li>akkauntni yaratish, autentifikatsiya va rolga asoslangan kirishni ta’minlash;</li>
        <li>davomat, filial hududi va tasdiqlash qoidalarini bajarish;</li>
        <li>so‘rovlar, hisobotlar, bildirishnomalar va kompaniya jarayonlarini yuritish;</li>
        <li>xatolarni aniqlash, firibgarlik va ruxsatsiz kirishning oldini olish;</li>
        <li>foydalanuvchi murojaatlariga javob berish va platforma sifatini yaxshilash;</li>
        <li>qonuniy talablar va vakolatli so‘rovlarga rioya etish.</li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "Ma’lumotlarni saqlash va himoya qilish",
    content: <p>Staffora ma’lumotlarga kirishni foydalanuvchi roli va kompaniya doirasi bilan cheklaydi, muhim amallarni audit jurnaliga yozadi va uzatish kanalida HTTPS’dan foydalanishga mo‘ljallangan. Mobil kirish ma’lumotlari qurilmaning himoyalangan saqlash mexanizmlarida saqlanishi mumkin. Hech bir axborot tizimi mutlaq xavfsizlikni kafolatlay olmaydi; shu sababli xavf aniqlanganda kirish cheklanishi, sessiyalar bekor qilinishi yoki qo‘shimcha tekshiruv talab etilishi mumkin.</p>,
  },
  {
    id: "sharing",
    title: "Uchinchi tomonlarga uzatish shartlari",
    content: (
      <>
        <p>Ma’lumotlar sotilmaydi va uchinchi tomon reklama profillarini yaratish uchun berilmaydi. Ma’lumotlar quyidagi cheklangan hollarda uzatilishi mumkin:</p>
        <ul>
          <li>foydalanuvchining ish beruvchisi va uning vakolatli xodimlariga, ularning roli doirasida;</li>
          <li>infratuzilma, hosting, xabarnoma yoki ilova tarqatish xizmatlariga, xizmatni bajarish uchun zarur hajmda;</li>
          <li>kompaniya sozlagan integratsiyalarga, faqat tegishli funksiya yoqilganda;</li>
          <li>qonuniy talab, sud hujjati yoki vakolatli davlat organining asosli so‘rovi bo‘yicha.</li>
        </ul>
        <p>Push bildirishnomalari qurilma platformasiga qarab Expo Push Service, Apple Push Notification service yoki Firebase Cloud Messaging orqali yetkazilishi mumkin. Telegram funksiyalaridan foydalanilganda tegishli ma’lumotlar Telegram infratuzilmasi orqali uzatiladi.</p>
      </>
    ),
  },
  {
    id: "permissions",
    title: "Geolokatsiya va qurilma ruxsatlari",
    content: <p>Kamera, joylashuv, bildirishnoma va mahalliy biometrik qulf faqat tegishli funksiya uchun so‘raladi. Ruxsatni qurilma sozlamalaridan bekor qilish mumkin, biroq bu QR skanerlash, hudud bo‘yicha davomat, yuz bilan tasdiqlash yoki bildirishnoma kabi funksiyalarning ishlamasligiga olib kelishi mumkin. Qurilmaning Face ID yoki barmoq izi namunasi Staffora’ga uzatilmaydi.</p>,
  },
  {
    id: "retention",
    title: "Ma’lumotlarni saqlash muddati",
    content: <p>Ma’lumotlar akkaunt faol bo‘lgan, mehnat yoki xizmat munosabatlari davom etgan hamda platforma funksiyasini taqdim etish uchun zarur bo‘lgan davrda saqlanadi. Keyingi muddat tashkilotning huquqiy majburiyatlari, nizolarni ko‘rib chiqish, audit, xavfsizlik va zaxira nusxalarini yangilash davri bilan belgilanadi. Zarurat tugagach ma’lumotlar o‘chiriladi yoki shaxs bilan bog‘lash imkoni cheklanadi.</p>,
  },
  {
    id: "rights",
    title: "Foydalanuvchining huquqlari",
    content: <p>Amaldagi qonunchilik va tashkilotning ma’lumotlar operatori sifatidagi vakolatiga qarab foydalanuvchi o‘z ma’lumotlari haqida axborot olish, ularga kirish, noto‘g‘ri ma’lumotlarni tuzatish, qayta ishlashni cheklash yoki qonuniy asos bo‘lmaganda o‘chirishni so‘rash huquqiga ega. Ish beruvchi kiritgan xodim ma’lumotlari bo‘yicha so‘rov avvalo tegishli tashkilot administratoriga yuborilishi mumkin.</p>,
  },
  {
    id: "deletion",
    title: "Ma’lumotlarni o‘chirish bo‘yicha so‘rov",
    content: <p>So‘rovni <Link to="/support">Yordam markazi</Link> orqali “Maxfiylik va ma’lumotlar” kategoriyasida yuboring yoki <a href="/delete-account.html">akkauntni o‘chirish tartibi</a> bilan tanishing. Shaxsni va so‘rovga vakolatni tekshirish talab etilishi mumkin. Qonunda saqlash majburiyati belgilangan ma’lumotlar tegishli muddat tugamaguncha o‘chirilmasligi mumkin.</p>,
  },
  {
    id: "children",
    title: "Bolalar maxfiyligi",
    content: <p>Staffora umumiy maqsaddagi bolalar xizmati emas va 16 yoshgacha bo‘lgan shaxslar uchun mustaqil akkaunt yaratishga mo‘ljallanmagan. Tashkilot voyaga yetmagan shaxs ma’lumotini qonuniy asosda qayta ishlashi zarur bo‘lsa, tegishli rozilik va himoya choralarini ta’minlash tashkilot zimmasida bo‘ladi.</p>,
  },
  {
    id: "changes",
    title: "Siyosatga o‘zgartirishlar",
    content: <p>Platforma funksiyalari yoki huquqiy talablar o‘zgarganda ushbu siyosat yangilanishi mumkin. Muhim o‘zgarishlar sahifadagi yangilanish sanasi, platformadagi bildirishnoma yoki mavjud aloqa kanallari orqali ma’lum qilinadi.</p>,
  },
  {
    id: "contact",
    title: "Bog‘lanish ma’lumotlari",
    content: <p>Maxfiylik, ma’lumotga kirish yoki o‘chirish bo‘yicha murojaatni <Link to="/support">Yordam markazi</Link> orqali yuboring. Amaldagi Telegram, elektron pochta va ish vaqti ma’lumotlari shu sahifada platforma administratori sozlagan qiymatlardan ko‘rsatiladi.</p>,
  },
];

export function PrivacyPage() {
  usePublicMeta({ title: "Maxfiylik siyosati — Staffora", description: "Staffora platformasida shaxsga doir ma’lumotlarni yig‘ish, ishlatish, saqlash va himoya qilish tartibi.", path: "/privacy" });
  return (
    <PublicLayout>
      <LegalHero eyebrow="Huquqiy hujjat" title="Maxfiylik siyosati" description="Ma’lumotlaringiz qanday yig‘ilishi, ishlatilishi va himoya qilinishini sodda va aniq tilda tushuntiramiz." updated="2026-yil 3-noyabr" />
      <LegalDocument sections={sections} />
    </PublicLayout>
  );
}
