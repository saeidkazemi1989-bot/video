/**
 * Offline copy engine data: hooks, on-screen lines, captions, CTAs and hashtags
 * in Persian (primary) and English. The caption engine composes these with the
 * analysed footage + the user's topic so every reel gets a fitting text.
 */

export const TONES = [
  { id: 'curious', label: 'کنجکاو', icon: '👀' },
  { id: 'bold', label: 'قاطع', icon: '🔥' },
  { id: 'warm', label: 'دلنشین', icon: '🤍' },
  { id: 'funny', label: 'شوخ', icon: '😄' },
  { id: 'aesthetic', label: 'هنری', icon: '✨' },
];

export const LANGS = [
  { id: 'fa', label: 'فارسی' },
  { id: 'en', label: 'English' },
];

export const CATEGORY_KEYWORDS = {
  food: ['غذا', 'پیتزا', 'کافه', 'رستوران', 'ناهار', 'شام', 'صبحانه', 'دسر', 'شیرینی', 'قهوه', 'چای', 'بستنی', 'آشپزی', 'دستور', 'نان', 'کباب', 'food', 'pizza', 'cafe', 'recipe', 'coffee', 'dessert', 'baking'],
  travel: ['سفر', 'مسافرت', 'تور', 'جاده', 'بلیط', 'هتل', 'گردش', 'travel', 'trip', 'tour', 'journey', 'vacation'],
  nature: ['طبیعت', 'کوه', 'جنگل', 'دریا', 'آبشار', 'غروب', 'طلوع', 'گل', 'باران', 'برف', 'آسمان', 'nature', 'forest', 'sunset', 'sea', 'mountain', 'sky'],
  fitness: ['باشگاه', 'تمرین', 'ورزش', 'بدنسازی', 'دویدن', 'یوگا', 'کراسفیت', 'فیتنس', 'عضله', 'gym', 'workout', 'fitness', 'run', 'training'],
  fashion: ['مد', 'فشن', 'لباس', 'استایل', 'مانتو', 'کفش', 'کیف', 'آرایش', 'آرایشگاه', 'شینیون', 'fashion', 'style', 'outfit', 'makeup', 'look'],
  business: ['کسب', 'کار', 'فروش', 'برند', 'پروژه', 'استارتاپ', 'مشتری', 'فروشگاه', 'کسبوکار', 'دفتر', 'شرکت', 'business', 'brand', 'startup', 'shop', 'agency', 'marketing'],
  wedding: ['عروسی', 'عقد', 'نامزدی', 'تولد', 'جشن', 'مهمانی', 'لباس عروس', 'wedding', 'birthday', 'party', 'engagement'],
  city: ['شهر', 'خیابان', 'برج', 'شهرگردی', 'تهران', 'شبگردی', 'city', 'street', 'urban', 'downtown'],
  product: ['محصول', 'معرفی', 'قیمت', 'خرید', 'کیفیت', 'آنباکس', 'product', 'review', 'unboxing', 'shop'],
  pet: ['گربه', 'سگ', 'پت', 'حیوان', 'طوطی', 'cat', 'dog', 'pet', 'kitten', 'puppy'],
  nightlife: ['کنسرت', 'پارتی', 'شب', 'موسیقی', 'دی‌جی', 'club', 'party', 'concert', 'dj', 'night'],
  personal: ['روزمرگی', 'زندگیم', 'خودم', 'ولگ', 'روز', 'خاطره', 'daily', 'vlog', 'mylife', 'memories'],
};

export const CATEGORY_LABELS = {
  fa: {
    general: 'عمومی', food: 'غذا', travel: 'سفر', nature: 'طبیعت', fitness: 'ورزش',
    fashion: 'مد و استایل', business: 'کسب‌وکار', wedding: 'جشن و عروسی', city: 'شهر',
    product: 'محصول', pet: 'حیوانات', nightlife: 'شب و موسیقی', personal: 'روزمرگی',
  },
  en: {
    general: 'general', food: 'food', travel: 'travel', nature: 'nature', fitness: 'fitness',
    fashion: 'fashion', business: 'business', wedding: 'wedding', city: 'city',
    product: 'product', pet: 'pets', nightlife: 'nightlife', personal: 'daily life',
  },
};

/* ------------------------------------------------------------------ */
/* hooks — the first line that stops the scroll                        */
/* ------------------------------------------------------------------ */
export const HOOKS = {
  fa: {
    general: [
      { t: 'چیزی که هیچ‌کس بهت نمی‌گه…', tones: ['curious'] },
      { t: 'صبر کن، اینو ببین 👀', tones: ['curious', 'funny'] },
      { t: 'اگه اینو رد کنی، پشیمون می‌شی', tones: ['bold', 'curious'] },
      { t: '{n} لحظه که نباید فراموش کنم 🤍', tones: ['warm'] },
      { t: 'بگو کدومش بهتر بود 👇', tones: ['funny'] },
      { t: '{n} ثانیه از یک روز کامل', tones: ['aesthetic'] },
      { t: 'اینو تا آخر ببین، ارزشش رو داره', tones: ['curious', 'bold'] },
      { t: 'یه راز کوچیک که هیچ‌وقت نگفتم', tones: ['warm', 'curious'] },
      { t: 'همه ازم می‌پرسن چطور این کارو کردم', tones: ['curious', 'bold'] },
      { t: 'یه لحظه سکوت… بعد این 👇', tones: ['aesthetic', 'funny'] },
    ],
    food: [
      { t: 'این غذا رو باید امتحان کنی 😋', tones: ['warm'] },
      { t: 'بهترین {topic} که تا حالا خوردم', tones: ['bold', 'warm'] },
      { t: '۳ مرحله تا یک {topic} بی‌نقص', tones: ['curious', 'aesthetic'] },
      { t: 'مرحله آخر معرکه‌ست، تا آخر ببین', tones: ['curious'] },
      { t: 'راز طعم واقعی {topic} 👨‍🍳', tones: ['bold'] },
      { t: 'اگه گرسنه‌ای اینو باز نکن 🚫', tones: ['funny'] },
      { t: 'با ۴ تا ماده، یه شام رستورانی', tones: ['bold', 'curious'] },
      { t: 'این کافه رو هیچ‌کس نمی‌شناسه', tones: ['curious', 'aesthetic'] },
    ],
    travel: [
      { t: 'بهترین جای این شهر رو پیدا کردم 📍', tones: ['curious'] },
      { t: '{topic} رو باید خودت ببینی', tones: ['aesthetic'] },
      { t: 'با کمترین هزینه رفتیم {topic}', tones: ['bold', 'funny'] },
      { t: 'جاهایی که توریست‌ها نمی‌بینن', tones: ['curious'] },
      { t: 'ذخیره کن برای سفر بعدیت 🧳', tones: ['warm'] },
      { t: 'این منظره رو تا ندیدی، نفهمیدی', tones: ['aesthetic', 'bold'] },
    ],
    nature: [
      { t: 'یک نفس عمیق وسط طبیعت 🌲', tones: ['aesthetic', 'warm'] },
      { t: 'این منظره واقعیه؟ باورنکردنیه', tones: ['curious'] },
      { t: 'آرامش همین‌جاست', tones: ['warm', 'aesthetic'] },
      { t: 'چند بار از این مسیر رد شدم و هنوز شگفت‌زده‌ام', tones: ['warm'] },
      { t: 'صدای اینجا رو باید بشنوی 🎧', tones: ['aesthetic'] },
    ],
    fitness: [
      { t: '{n} حرکت برای شروع همین امروز 💪', tones: ['bold'] },
      { t: 'هیچ بهانه‌ای نمونده', tones: ['bold', 'funny'] },
      { t: 'قبل و بعد — باورت نمی‌شه', tones: ['curious'] },
      { t: 'این تمرین رو اشتباه انجام می‌دادی', tones: ['curious'] },
      { t: 'ماهی یک بار شروع کن، همون کافیه', tones: ['warm'] },
    ],
    fashion: [
      { t: 'این ست رو از دست نده 🖤', tones: ['bold'] },
      { t: 'کدوم بهتره؟ برام بنویس 👗', tones: ['funny', 'curious'] },
      { t: 'ساده اما شیک — همیشه جواب می‌ده', tones: ['aesthetic'] },
      { t: 'یک استایل برای هر روز هفته', tones: ['curious'] },
      { t: 'جزئیات همون چیزیه که فرق می‌سازه ✨', tones: ['aesthetic', 'warm'] },
    ],
    business: [
      { t: 'یه نکته که فروشت رو دو برابر می‌کنه', tones: ['bold'] },
      { t: 'پشت صحنه کارمون رو ببین', tones: ['curious'] },
      { t: 'چطور {topic} رو ساختیم', tones: ['curious'] },
      { t: 'مشتری همیشه دنبال این چیزه 👇', tones: ['bold'] },
      { t: '۳ اشتباه رایج که پول می‌سوزونه', tones: ['bold', 'curious'] },
    ],
    wedding: [
      { t: 'روزی که همه‌چیز کامل بود 💍', tones: ['warm', 'aesthetic'] },
      { t: 'بعد از سال‌ها هنوز همون حس', tones: ['warm'] },
      { t: 'لحظه‌ای که هیچ‌وقت فراموش نمی‌کنیم', tones: ['aesthetic'] },
      { t: 'دستت رو بده و بیا 🤍', tones: ['warm'] },
    ],
    city: [
      { t: 'اینجا زندگی جریان داره 🌃', tones: ['aesthetic'] },
      { t: 'شب‌های {topic} رنگ دیگه‌ای دارن', tones: ['aesthetic', 'warm'] },
      { t: 'شهر رو از این زاویه ندیدی', tones: ['curious'] },
    ],
    product: [
      { t: '{topic} رو از نزدیک ببین', tones: ['curious'] },
      { t: 'قبل از خرید اینو ببین', tones: ['curious', 'bold'] },
      { t: 'کیفیت رو با چشم ببین 👀', tones: ['bold', 'curious'] },
    ],
    pet: [
      { t: 'بامزه‌ترین چیز امروز 🐾', tones: ['funny'] },
      { t: 'دقیقاً چرا این کار رو می‌کنه؟ 😂', tones: ['funny', 'curious'] },
      { t: 'رفتارش هر روز عجیب‌تر می‌شه', tones: ['funny'] },
      { t: 'قلبم برای این کوچولو 🤍', tones: ['warm'] },
    ],
    nightlife: [
      { t: 'شب ما این‌طوری شروع شد 🎶', tones: ['funny', 'bold'] },
      { t: 'انرژی اینجا رو حس کن', tones: ['aesthetic', 'bold'] },
      { t: 'بهترین شب هفته‌مون', tones: ['warm'] },
    ],
    personal: [
      { t: 'یک روز معمولی از زندگی من', tones: ['warm'] },
      { t: '{n} نما از یک حال خوب', tones: ['aesthetic'] },
      { t: 'به گذشته که نگاه می‌کنم…', tones: ['warm', 'curious'] },
      { t: 'من الان اینجام، تو چی؟ 💬', tones: ['funny', 'warm'] },
    ],
  },
  en: {
    general: [
      { t: 'Nobody told me this…', tones: ['curious'] },
      { t: 'Wait for it 👀', tones: ['curious', 'funny'] },
      { t: '{n} moments I never want to forget', tones: ['warm'] },
      { t: 'Watch till the end', tones: ['bold', 'curious'] },
      { t: 'You had to be there', tones: ['aesthetic'] },
      { t: 'POV: the best part of my day', tones: ['funny', 'aesthetic'] },
    ],
    food: [
      { t: 'You have to try this 😋', tones: ['warm'] },
      { t: 'Best {topic} I have ever had', tones: ['bold', 'warm'] },
      { t: '3 steps to perfect {topic}', tones: ['curious', 'aesthetic'] },
      { t: 'The secret to real flavour 👨‍🍳', tones: ['bold'] },
    ],
    travel: [
      { t: 'Found the best spot in town 📍', tones: ['curious'] },
      { t: 'You have to see {topic} yourself', tones: ['aesthetic'] },
      { t: 'Hidden places tourists never find', tones: ['curious'] },
      { t: 'Save this for your next trip 🧳', tones: ['warm'] },
    ],
    nature: [
      { t: 'Breathe in 🌲', tones: ['aesthetic', 'warm'] },
      { t: 'Is this place even real?', tones: ['curious'] },
      { t: 'Peace lives right here', tones: ['warm', 'aesthetic'] },
    ],
    fitness: [
      { t: '{n} moves to start today 💪', tones: ['bold'] },
      { t: 'No more excuses', tones: ['bold', 'funny'] },
      { t: 'You were doing this wrong', tones: ['curious'] },
    ],
    fashion: [
      { t: 'Do not sleep on this fit 🖤', tones: ['bold'] },
      { t: 'Which one wins? Comment 👗', tones: ['funny', 'curious'] },
      { t: 'Simple but sharp — always works', tones: ['aesthetic'] },
    ],
    business: [
      { t: 'One tip that doubled our sales', tones: ['bold'] },
      { t: 'Behind the scenes', tones: ['curious'] },
      { t: 'How we built {topic}', tones: ['curious'] },
    ],
    wedding: [
      { t: 'The day everything was perfect 💍', tones: ['warm', 'aesthetic'] },
      { t: 'Still the same feeling', tones: ['warm'] },
    ],
    city: [
      { t: 'The city is alive 🌃', tones: ['aesthetic'] },
      { t: 'You have never seen it like this', tones: ['curious'] },
    ],
    product: [
      { t: 'See {topic} up close', tones: ['curious'] },
      { t: 'Watch this before you buy', tones: ['curious', 'bold'] },
    ],
    pet: [
      { t: 'The cutest thing today 🐾', tones: ['funny'] },
      { t: 'Why does he do this? 😂', tones: ['funny', 'curious'] },
    ],
    nightlife: [
      { t: 'Our night started like this 🎶', tones: ['funny', 'bold'] },
      { t: 'Feel the energy', tones: ['aesthetic', 'bold'] },
    ],
    personal: [
      { t: 'A normal day in my life', tones: ['warm'] },
      { t: 'Looking back at this…', tones: ['warm', 'curious'] },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* on-screen lines (placed on cuts, synced to the beat)                */
/* ------------------------------------------------------------------ */
export const BEAT_LINES = {
  fa: {
    general: ['ببین', 'صبر کن', 'اینجا رو ببین', 'ادامه بده', 'نزدیک‌تر', 'و بعد…', 'بهترین قسمت', 'آخرش رو ببین', 'همین لحظه', 'یک نفس'],
    category: {
      food: ['مرحله ۱', 'مرحله ۲', 'مرحله ۳', 'طعم واقعی', 'داغ و تازه', 'خودت امتحان کن', 'منوی مخفی'],
      travel: ['ایستگاه اول', 'جای مخفی', 'منظره بی‌نظیر', 'برو ببین', 'اینجا بمان', 'غروب'],
      nature: ['آرامش', 'نفس بکش', 'صدای طبیعت', 'نور طلایی', 'خالص'],
      fitness: ['حرکت ۱', 'حرکت ۲', 'تمرین سخت', 'بدون بهانه', 'ادامه بده', 'نتیجه می‌گیری'],
      fashion: ['ست اول', 'ست دوم', 'جزئیات', 'کدوم؟', 'شیک و ساده', 'انتخاب تو'],
      business: ['قبل', 'بعد', 'نتیجه', 'پشت صحنه', 'گام بعدی', 'تجربه مشتری'],
      wedding: ['آماده‌شدن', 'لحظه ورود', 'اولین نگاه', 'رقص', 'جشن', 'خاطره'],
      city: ['شب', 'خیابان', 'چراغ‌ها', 'حرکت', 'شهر من'],
      product: ['جزئیات', 'کیفیت', 'اولین نگاه', 'مقایسه', 'ارزش خرید'],
      pet: ['بامزه', 'شیطون', 'نگاه کن', 'دوباره!', 'بغلش کن'],
      nightlife: ['شروع', 'انرژی', 'رقص', 'بودن با دوست‌ها', 'شب'],
      personal: ['صبح', 'ظهر', 'عصر', 'شب', 'همین حالا'],
    },
  },
  en: {
    general: ['Look', 'Hold on', 'Check this', 'Keep watching', 'Closer', 'And then…', 'Best part', 'Watch the end'],
    category: {
      food: ['Step 1', 'Step 2', 'Real flavour', 'Fresh', 'Try it'],
      travel: ['Stop 1', 'Hidden gem', 'View', 'Go see it'],
      fitness: ['Move 1', 'Move 2', 'No excuses', 'Keep going'],
      fashion: ['Look 1', 'Look 2', 'Details', 'Which one?'],
      business: ['Before', 'After', 'Result', 'Behind the scenes'],
      wedding: ['Getting ready', 'The entrance', 'First look', 'Dance'],
      city: ['Night', 'Street', 'Lights', 'Motion'],
      product: ['Details', 'Quality', 'First look'],
      pet: ['Cute', 'Naughty', 'Look!', 'Again!'],
      nightlife: ['Start', 'Energy', 'Dance'],
      personal: ['Morning', 'Noon', 'Evening', 'Night'],
    },
  },
};

/* ------------------------------------------------------------------ */
/* caption bodies                                                      */
/* ------------------------------------------------------------------ */
export const CAPTIONS = {
  fa: {
    general: [
      ['{n} لحظه که ارزش دیدن داشت 🤍', 'کدومش رو بیشتر دوست داشتی؟ برام بنویس 👇'],
      ['بعضی روزها فقط باید ثبت بشن ✨', 'این لحظه‌ها رو برای خودم نگه می‌دارم.'],
      ['زندگی از همین لحظه‌های کوچیک ساخته شده.', 'اگه تو هم چنین روزی داشتی، بگو 💬'],
    ],
    food: [
      ['با چند تا ماده ساده، یک شام رستورانی 🍽️', 'دستور کامل رو می‌تونی ازم بپرسی 👇'],
      ['این {topic} رو حتماً امتحان کن 😋', 'سیو کن تا فراموش نشه 📌', 'نظرت رو بنویس 👇'],
    ],
    travel: [
      ['{topic} یکی از بهترین جاهایی بود که رفتم 🧳', 'آدرس رو برات کامنت می‌کنم 📍'],
      ['سفر خوب همونیه که یه‌کم هم گم بشی.', 'ذخیره کن برای سفر بعدی 💾'],
    ],
    nature: [
      ['چند ساعت دور از شلوغی، همین کافیه 🌿', 'آرامش اینجا واقعاً حس می‌شه.'],
      ['نور این ساعت از روز رو از دست نده.', 'بهترین زمان برای عکاسی همین بود 📸'],
    ],
    fitness: [
      ['{n} حرکت برای شروع، بدون تجهیزات 💪', 'هر روز فقط ۱۵ دقیقه کافیه.', 'سیو کن و از فردا شروع کن 🔥'],
      ['پیشرفت با تکرار ساخته می‌شه، نه با انگیزه.', 'برنامه‌ات رو بفرست تا برات بچینم 👇'],
    ],
    fashion: [
      ['استایل امروز، ساده اما حساب‌شده 🖤', 'کدوم قسمت رو بیشتر دوست داشتی؟ 👗'],
      ['جزئیات کوچیک، تفاوت بزرگ می‌سازن ✨', 'لینک‌ها رو بپرس 💬'],
    ],
    business: [
      ['این کار رو برای برندمون انجام دادیم 📈', 'اگه سوالی داری بپرس، راحت جواب می‌دم 👇'],
      ['سه نکته‌ای که تجربه بهمون داد.', 'سیو کن، بعداً به کارت میاد 📌'],
    ],
    wedding: [
      ['روزی که برای همیشه یادمون می‌مونه 💍', 'برای این زوج آرزوی بهترین‌ها رو داریم 🤍'],
      ['لحظه‌های کوچیک، خاطره‌های بزرگ.', 'چه لحظه‌ای برای تو قشنگ‌تر بود؟ 💬'],
    ],
    city: [
      ['شهر وقتی خوابه، قشنگ‌ترین شکلش رو داره 🌃', 'این زاویه رو قبلاً دیده بودی؟'],
      ['شب و نور و حرکت.', 'کدوم شات رو بیشتر دوست داشتی؟ 📸'],
    ],
    product: [
      ['{topic} — از نزدیک ببین 👀', 'کیفیت رو با چشم می‌بینی.', 'سوالاتت رو بپرس 💬'],
      ['قبل از خرید اینو ببین.', 'چیزی که برام مهم بود، جزئیاتش بود ✨'],
    ],
    pet: [
      ['این کوچولو امروز کلی خندوندم 🐾', 'اسمش رو حدس بزن 👇'],
      ['انرژی این بچه‌ها واگیرداره 😂', 'تگ کن اون دوستی که عاشق پت‌هاست 🐶'],
    ],
    nightlife: [
      ['شب‌هایی که هیچ‌وقت فراموش نمی‌شن 🎶', 'با کی بودی؟ تگ کن 👇'],
      ['انرژی این مهمونی رو از دست نده ✨', 'بهترین شب هفته بود.'],
    ],
    personal: [
      ['یک روز معمولی، اما دوست‌داشتنی 🤍', 'ممنون که همراهم هستی 💬'],
      ['ثبت کردن روزها، یه جور مراقبه‌ست.', 'تو چطور روزت رو ثبت می‌کنی؟ ✍️'],
    ],
  },
  en: {
    general: [
      ['{n} moments worth watching 🤍', 'Which one was your favourite? Comment 👇'],
      ['Some days just deserve to be filmed ✨'],
    ],
    food: [['Simple ingredients, restaurant result 🍽️', 'Full recipe in the comments 👇']],
    travel: [['{topic} is one of the best places I visited 🧳', 'Saving the location for you 📍']],
    nature: [['A few hours away from the noise 🌿', 'That light though.']],
    fitness: [['{n} moves, no equipment 💪', 'Save this and start tomorrow 🔥']],
    fashion: [['Simple but sharp 🖤', 'Which part did you like most? 👗']],
    business: [['This is what we did for the brand 📈', 'Ask me anything 👇']],
    wedding: [['A day we will never forget 💍']],
    city: [['The city at night hits different 🌃']],
    product: [['{topic} up close 👀', 'Watch this before you buy.']],
    pet: [['This little one made my day 🐾']],
    nightlife: [['Nights we will never forget 🎶']],
    personal: [['A very normal, very lovely day 🤍']],
  },
};

export const CTAS = {
  fa: [
    'ذخیره کن برای بعد 📌',
    'نظرت رو برام بنویس 👇',
    'تگ کن اون دوستی که باید ببینه 😄',
    'فالو کن برای بیشتر ✨',
    'بهم بگو کدومش رو دوست داشتی 💬',
    'بفرست برای کسی که این رو لازم داره 🔁',
  ],
  en: [
    'Save this for later 📌',
    'Tell me what you think 👇',
    'Tag a friend who needs this 😄',
    'Follow for more ✨',
    'Which one was your favourite? 💬',
  ],
};

export const QUESTIONS = {
  fa: ['کدومش رو بیشتر دوست داشتی؟', 'تو چی کار می‌کنی؟', 'موافقی یا نه؟', 'تجربه‌ت رو بگو 👇'],
  en: ['Which one did you like most?', 'What would you do?', 'Agree or not?', 'Tell me your story 👇'],
};

export const HASHTAGS = {
  fa: {
    general: ['#ریلز', '#ریلزفارسی', '#ویدیوشاد', '#لحظه‌ها', '#لاکچری', '#ایران', '#موزیک_ویدیو', '#explore', '#trending', '#viral', '#reels', '#viralpost', '#اوقات_خوش', '#خاطره', '#explorepage', '#برای_تو', '#ویدیو_جدید', '#طبیعت_ایران', '#تهران', '#شیراز'],
    food: ['#غذا', '#آشپزی', '#دستور_پخت', '#کافه', '#رستوران', '#خوشمزه', '#فود_تاک', '#پیتزا', '#کیک', '#دسر', '#فودبلاگر', '#ناهار', '#شام_خاص', '#healthyfood', '#foodie', '#recipe', '#cooking', '#tasty', '#instafood', '#foodphotography'],
    travel: ['#سفر', '#گردشگری', '#طبیعت_گردی', '#جاذبه_های_گردشگری', '#ایرانگردی', '#مسافرت', '#travel', '#traveling', '#wanderlust', '#roadtrip', '#explore', '#traveltips', '#iran', '#iran_tourism', '#سفر_ارزان', '#هتل', '#جاده', '#gopro', '#travelphotography', '#iranian'],
    nature: ['#طبیعت', '#طبیعت_بکر', '#کوهنوردی', '#دریا', '#جنگل', '#غروب', '#آسمان', '#nature', '#naturephotography', '#sunset', '#forest', '#mountains', '#landscape', '#peaceful', '#sky', '#naturelovers', '#آرامش', '#خورشید', '#باران', '#درخت'],
    fitness: ['#ورزش', '#فیتنس', '#باشگاه', '#بدنسازی', '#تمرین', '#سلامتی', '#تناسب_اندام', '#gym', '#fitness', '#workout', '#healthylifestyle', '#bodybuilding', '#motivation', '#training', '#noexcuses', '#کالری', '#لاغری', '#عضله', '#fitnessmotivation', '#sport'],
    fashion: ['#مد', '#فشن', '#استایل', '#مانتو', '#لباس', '#آرایش', '#مدلینگ', '#فشن_ایرانی', '#فشن_استایل', '#fashion', '#style', '#ootd', '#makeup', '#beauty', '#outfit', '#fashionblogger', '#lookbook', '#hair', '#مانتوی_شیک', '#ست_شیک'],
    business: ['#کسب_و_کار', '#کارآفرینی', '#بیزینس', '#برندینگ', '#دیجیتال_مارکتینگ', '#فروش', '#استارتاپ', '#بازاریابی', '#business', '#marketing', '#entrepreneur', '#startup', '#branding', '#smallbusiness', '#success', '#growth', '#کسب_وکار_آنلاین', '#فروشگاه_اینترنتی', '#سئو', '#تبلیغات'],
    wedding: ['#عروسی', '#عقد', '#لباس_عروس', '#مراسم_عروسی', '#تولد', '#جشن', '#wedding', '#weddingday', '#bride', '#groom', '#weddingphotography', '#engagement', '#عروسی_خاص', '#تاج_عروس', '#آرایش_عروس', '#جشن_تولد', '#حنا', '#نامزدی', '#love', '#weddingdecor'],
    city: ['#شهر', '#شب_شهر', '#خیابان', '#شهرگردی', '#lifeincity', '#streetphotography', '#citylights', '#urban', '#nightphotography', '#cityscape', '#تهران_گردی', '#شبگردی', '#برج', '#moody', '#cityvibes'],
    product: ['#معرفی_محصول', '#کیفیت', '#خرید_آنلاین', '#فروش_ویژه', '#آنباکس', '#product', '#review', '#unboxing', '#shopping', '#newproduct', '#قیمت_مناسب', '#تخفیف', '#فروشگاه', '#مالتیمدیا'],
    pet: ['#حیوانات', '#گربه', '#سگ', '#پت', '#حیوان_خانگی', '#cats', '#dogs', '#petsofinstagram', '#cuteanimals', '#puppy', '#kitten', '#animalvideos', '#بامزه', '#petlovers', '#meow'],
    nightlife: ['#مهمونی', '#رقص', '#موسیقی', '#کنسرت', '#شب_خوش', '#dj', '#party', '#nightlife', '#music', '#livemusic', '#dance', '#vibes', '#friends', '#celebration'],
    personal: ['#روزمرگی', '#ولگ', '#زندگی_من', '#حال_خوب', '#خاطره_بازی', '#daily', '#vlog', '#dailylife', '#mood', '#moments', '#selflove', '#اینجا_و_الان', '#صبح_بخیر', '#حال_دل'],
  },
  en: {
    general: ['#reels', '#viral', '#explorepage', '#trending', '#fyp', '#instagood', '#videooftheday', '#moments', '#reelsinstagram', '#explore'],
    food: ['#food', '#foodie', '#recipe', '#tasty', '#instafood', '#cooking', '#foodphotography', '#yummy', '#homemade'],
    travel: ['#travel', '#wanderlust', '#trip', '#explore', '#travelphotography', '#adventure', '#roadtrip'],
    nature: ['#nature', '#sunset', '#landscape', '#forest', '#peaceful', '#naturelovers'],
    fitness: ['#fitness', '#workout', '#gym', '#training', '#motivation', '#healthylifestyle'],
    fashion: ['#fashion', '#style', '#ootd', '#outfit', '#beauty', '#makeup'],
    business: ['#business', '#marketing', '#entrepreneur', '#startup', '#branding', '#smallbusiness'],
    wedding: ['#wedding', '#weddingday', '#bride', '#love', '#engagement'],
    city: ['#city', '#streetphotography', '#citylights', '#urban', '#nightphotography'],
    product: ['#product', '#review', '#unboxing', '#shopping', '#newproduct'],
    pet: ['#pets', '#cat', '#dog', '#cuteanimals', '#petlovers'],
    nightlife: ['#party', '#nightlife', '#music', '#dj', '#friends'],
    personal: ['#daily', '#vlog', '#dailylife', '#moments', '#mood'],
  },
};

export function detectCategory(text = '') {
  const t = String(text).toLowerCase();
  if (!t.trim()) return 'general';
  let best = 'general', bestScore = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const w of words) if (t.includes(w.toLowerCase())) score += w.length > 3 ? 2 : 1;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}
