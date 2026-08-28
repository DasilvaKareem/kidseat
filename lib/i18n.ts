export const LOCALES = ["en", "zh-Hans", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "中文",
  es: "Español",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

type Copy = {
  common: {
    continue: string;
    skip: string;
    back: string;
    step: string;
    serverError: string;
    rateLimited: string;
  };
  phone: {
    title: string;
    sub: string;
    label: string;
    placeholder: string;
    consent: string;
    error: string;
  };
  zip: {
    title: string;
    sub: string;
    placeholder: string;
    error: string;
    outOfAreaTitle: string;
    outOfAreaBody: string;
    outOfAreaAction: string;
  };
  household: { title: string; sub: string; options: [string, string][] };
  needs: { title: string; sub: string; options: [string, string][] };
  done: { title: string; body: string; keywords: string };
  screening: {
    cta: string;
    title: string;
    sub: string;
    skipQuestion: string;
    skipAll: string;
    finish: string;
    resultsTitle: string;
    resultsSub: string;
    confidence: { likely: string; possible: string; open_to_all: string };
    documents: string;
    privacy: string;
    none: string;
  };
};

// Consent wording is versioned. Bump CONSENT_VERSION on ANY change to
// phone.consent in any locale — the exact rendered string is what gets stored.
export const CONSENT_VERSION = "2026-08-28.1";

export const COPY: Record<Locale, Copy> = {
  en: {
    common: {
      continue: "Continue",
      skip: "Skip",
      back: "Back",
      step: "Step",
      serverError: "Something went wrong on our end. Please try again.",
      rateLimited: "Too many tries. Please wait a few minutes.",
    },
    phone: {
      title: "Get free food alerts",
      sub: "We text you when there is free food near you.",
      label: "Your mobile number",
      placeholder: "(415) 555-0123",
      consent:
        "We'll text you when free food is near you. Message and data rates may apply. Text STOP anytime to quit. We use your number only to send food alerts. We never sell your information.",
      error: "Enter a 10-digit mobile number",
    },
    zip: {
      title: "What's your ZIP code?",
      sub: "We use it to find food near you.",
      placeholder: "94103",
      error: "Enter a 5-digit ZIP code",
      outOfAreaTitle: "We're only in San Francisco and Marin right now",
      outOfAreaBody: "Call or text 211 for free food help anywhere in the Bay Area.",
      outOfAreaAction: "Text me when you reach my area",
    },
    household: {
      title: "How many people do you feed?",
      sub: "This helps us send the right amount.",
      options: [
        ["1", "Just me"],
        ["2-3", "2 to 3"],
        ["4-5", "4 to 5"],
        ["6+", "6 or more"],
      ],
    },
    needs: {
      title: "Anything we should know?",
      sub: "Choose any that apply, or skip.",
      options: [
        ["no_fridge", "No fridge"],
        ["no_stove", "No stove"],
        ["baby", "Baby food or formula"],
        ["halal_kosher", "Halal or kosher"],
        ["low_mobility", "Hard to travel"],
        ["allergies", "Food allergies"],
      ],
    },
    done: {
      title: "You're signed up",
      body: "We'll text you within a day when there's free food near {zip}.",
      keywords: "Text STOP to quit. Text FOOD anytime to find food right now.",
    },
    screening: {
      cta: "See what else you can get",
      title: "A few more questions",
      sub: "Most people qualify for more than they think. Skip anything you'd rather not answer.",
      skipQuestion: "Skip this question",
      skipAll: "Not now",
      finish: "Show me",
      resultsTitle: "You may be able to get",
      resultsSub: "This is an estimate, not a decision. The county decides.",
      confidence: { likely: "Likely", possible: "Maybe", open_to_all: "Open to everyone" },
      documents: "Brings ID or proof of income",
      privacy: "We keep none of these answers. Only which programs to point you to.",
      none: "Nothing extra came up — but pantries are open to anyone, with no questions asked.",
    },
  },
  "zh-Hans": {
    common: {
      continue: "继续",
      skip: "跳过",
      back: "返回",
      step: "第",
      serverError: "我们这边出了点问题。请再试一次。",
      rateLimited: "尝试次数过多。请等几分钟再试。",
    },
    phone: {
      title: "获取免费食物提醒",
      sub: "附近有免费食物时，我们会发短信通知您。",
      label: "您的手机号码",
      placeholder: "(415) 555-0123",
      consent:
        "附近有免费食物时，我们会发短信通知您。可能产生短信和数据费用。随时回复 STOP 退订。您的号码只用于发送食物提醒。我们绝不出售您的信息。",
      error: "请输入 10 位手机号码",
    },
    zip: {
      title: "您的邮政编码是多少？",
      sub: "我们用它来查找您附近的食物。",
      placeholder: "94103",
      error: "请输入 5 位邮政编码",
      outOfAreaTitle: "我们目前只服务旧金山和马林县",
      outOfAreaBody: "湾区任何地方都可以拨打或发短信至 211 寻求免费食物帮助。",
      outOfAreaAction: "服务到我这里时通知我",
    },
    household: {
      title: "您要为几个人准备食物？",
      sub: "这有助于我们提供合适的份量。",
      options: [
        ["1", "只有我"],
        ["2-3", "2 至 3 人"],
        ["4-5", "4 至 5 人"],
        ["6+", "6 人或以上"],
      ],
    },
    needs: {
      title: "还有什么需要我们知道的吗？",
      sub: "可多选，也可以跳过。",
      options: [
        ["no_fridge", "没有冰箱"],
        ["no_stove", "没有炉灶"],
        ["baby", "婴儿食品或奶粉"],
        ["halal_kosher", "清真或洁食"],
        ["low_mobility", "出行不便"],
        ["allergies", "食物过敏"],
      ],
    },
    done: {
      title: "您已注册成功",
      body: "一天之内，{zip} 附近有免费食物时我们会发短信给您。",
      keywords: "回复 STOP 退订。随时回复 FOOD 立即查找食物。",
    },
    screening: {
      cta: "看看您还能获得什么",
      title: "再回答几个问题",
      sub: "多数人符合的项目比自己以为的多。不想回答的可以跳过。",
      skipQuestion: "跳过此题",
      skipAll: "以后再说",
      finish: "查看结果",
      resultsTitle: "您可能可以获得",
      resultsSub: "这只是估计，不是决定，最终由县政府决定。",
      confidence: { likely: "很可能", possible: "也许", open_to_all: "人人可用" },
      documents: "需要证件或收入证明",
      privacy: "我们不保存这些答案，只保存该为您推荐哪些项目。",
      none: "没有额外项目 — 但食物领取点对所有人开放，无需任何证明。",
    },
  },
  es: {
    common: {
      continue: "Continuar",
      skip: "Omitir",
      back: "Atrás",
      step: "Paso",
      serverError: "Hubo un problema de nuestro lado. Intente de nuevo.",
      rateLimited: "Demasiados intentos. Espere unos minutos.",
    },
    phone: {
      title: "Reciba avisos de comida gratis",
      sub: "Le enviamos un mensaje cuando hay comida gratis cerca.",
      label: "Su número de celular",
      placeholder: "(415) 555-0123",
      consent:
        "Le enviaremos un mensaje de texto cuando haya comida gratis cerca de usted. Pueden aplicarse tarifas de mensajes y datos. Envíe STOP en cualquier momento para cancelar. Usamos su número solo para enviar avisos de comida. Nunca vendemos su información.",
      error: "Ingrese un número de celular de 10 dígitos",
    },
    zip: {
      title: "¿Cuál es su código postal?",
      sub: "Lo usamos para encontrar comida cerca de usted.",
      placeholder: "94103",
      error: "Ingrese un código postal de 5 dígitos",
      outOfAreaTitle: "Por ahora solo estamos en San Francisco y Marin",
      outOfAreaBody: "Llame o envíe un mensaje al 211 para ayuda con comida gratis en toda el Área de la Bahía.",
      outOfAreaAction: "Avísenme cuando lleguen a mi área",
    },
    household: {
      title: "¿Para cuántas personas cocina?",
      sub: "Esto nos ayuda a enviar la cantidad correcta.",
      options: [
        ["1", "Solo yo"],
        ["2-3", "2 a 3"],
        ["4-5", "4 a 5"],
        ["6+", "6 o más"],
      ],
    },
    needs: {
      title: "¿Algo que debamos saber?",
      sub: "Elija las que apliquen, o omita.",
      options: [
        ["no_fridge", "No tengo refrigerador"],
        ["no_stove", "No tengo estufa"],
        ["baby", "Comida o fórmula para bebé"],
        ["halal_kosher", "Halal o kosher"],
        ["low_mobility", "Me cuesta trasladarme"],
        ["allergies", "Alergias alimentarias"],
      ],
    },
    done: {
      title: "Ya está inscrito",
      body: "Le enviaremos un mensaje dentro de un día cuando haya comida gratis cerca de {zip}.",
      keywords: "Envíe STOP para cancelar. Envíe FOOD en cualquier momento para encontrar comida ahora.",
    },
    screening: {
      cta: "Vea qué más puede recibir",
      title: "Unas preguntas más",
      sub: "Casi todos califican para más de lo que creen. Omita lo que no quiera contestar.",
      skipQuestion: "Omitir esta pregunta",
      skipAll: "Ahora no",
      finish: "Mostrar",
      resultsTitle: "Puede que califique para",
      resultsSub: "Esto es una estimación, no una decisión. El condado decide.",
      confidence: { likely: "Probable", possible: "Quizás", open_to_all: "Para todos" },
      documents: "Pide identificación o comprobante de ingresos",
      privacy: "No guardamos estas respuestas. Solo a qué programas dirigirle.",
      none: "No salió nada extra, pero las despensas están abiertas para todos, sin preguntas.",
    },
  },
};

// --- map app ----------------------------------------------------------------
// Kept separate from the onboarding Copy type: the SMS flow and the web app are
// different surfaces with different vocabularies, and merging them would make
// every translation change touch both.

type FindCopy = {
  title: string;
  searchArea: string;
  places: { one: string; other: string };
  loading: string;
  none: string;
  filters: { pantries: string; events: string; today: string; noId: string; clear: string };
  tagLabels: Record<string, string>;
  card: { programs: { one: string; other: string }; noId: string; bring: string; directions: string; call: string };
  apply: {
    action: string;
    applied: string;
    title: string;
    submit: string;
    success: string;
    processing: string;
    required: string;
    mine: string;
    withdraw: string;
    empty: string;
  };
  status: Record<string, string>;
  auth: {
    signIn: string;
    signOut: string;
    title: string;
    sub: string;
    phoneLabel: string;
    codeLabel: string;
    send: string;
    verify: string;
    resend: string;
    wrongCode: string;
    expired: string;
    tooMany: string;
  };
  chat: { placeholder: string; locked: string; send: string; title: string; intro: string };
  close: string;
  mapUnavailable: string;
  directions: {
    title: string;
    walk: string; transit: string; drive: string; bike: string;
    lessWalking: string; fewerTransfers: string;
    minutes: string; openInMaps: string; noRoute: string;
    useMyLocation: string; locationDenied: string;
    board: string; getOff: string; fare: string; caveat: string;
  };
  access: {
    title: string;
    unknown: string;
    filter: string;
    labels: Record<string, string>;
  };
};

export const FIND: Record<Locale, FindCopy> = {
  en: {
    title: "Free food near you",
    searchArea: "Search this area",
    places: { one: "1 place", other: "{n} places" },
    loading: "Loading…",
    none: "Nothing in this area. Try zooming out or clearing filters.",
    filters: { pantries: "Pantries", events: "Events", today: "Today", noId: "No ID needed", clear: "Clear" },
    tagLabels: {
      shelf_stable: "Shelf-stable", prepared: "Hot meals", delivery: "Delivery",
      halal: "Halal", kosher: "Kosher", baby: "Baby food",
    },
    card: { programs: { one: "1 program", other: "{n} programs" }, noId: "No ID needed", bring: "Bring: {x}", directions: "Directions", call: "Call" },
    apply: {
      action: "Apply",
      applied: "Applied",
      title: "Apply to {name}",
      submit: "Submit application",
      success: "Application submitted.",
      processing: "Usually answered in about {n} days.",
      required: "Please fill this in",
      mine: "My applications",
      withdraw: "Withdraw",
      empty: "You have not applied to anything yet.",
    },
    status: {
      submitted: "Submitted", in_review: "In review", approved: "Approved",
      denied: "Not approved", withdrawn: "Withdrawn",
    },
    auth: {
      signIn: "Sign in", signOut: "Sign out",
      title: "Sign in with your phone",
      sub: "We'll text you a 6-digit code. No password.",
      phoneLabel: "Your mobile number",
      codeLabel: "6-digit code",
      send: "Send code", verify: "Sign in", resend: "Send a new code",
      wrongCode: "That code didn't match. Try again.",
      expired: "That code expired. Send a new one.",
      tooMany: "Too many tries. Send a new code.",
    },
    chat: {
      placeholder: "Ask about food near you",
      locked: "Sign in to ask a question",
      send: "Send",
      title: "Ask",
      intro: "Ask me where to get food today, what you can apply to, or what to bring.",
    },
    close: "Close",
    mapUnavailable: "Map is not configured. The list still works.",
  directions: {
    title: "Directions",
    walk: "Walk", transit: "Transit", drive: "Drive", bike: "Bike",
    lessWalking: "Less walking", fewerTransfers: "Fewer transfers",
    minutes: "{n} min", openInMaps: "Open in Google Maps",
    noRoute: "We couldn't build a route. Open it in Google Maps instead.",
    useMyLocation: "Use my location",
    locationDenied: "Location is off, so this uses your ZIP code.",
    board: "Take {line} toward {headsign}",
    getOff: "Get off at {stop}",
    fare: "Fare about {x}",
    caveat: "\"Less walking\" is not the same as a step-free route. Call ahead if you need one.",
  },
  access: {
    title: "Accessibility",
    unknown: "Not listed — call to check",
    filter: "Wheelchair access",
    labels: {
      wheelchair: "Wheelchair accessible", step_free: "No steps",
      accessible_restroom: "Accessible restroom", seating: "Seating available",
      near_transit: "Near transit", parking: "Accessible parking",
      asl: "ASL available", service_animal_ok: "Service animals welcome",
    },
  },
  },
  "zh-Hans": {
    title: "附近的免费食物",
    searchArea: "搜索此区域",
    places: { one: "{n} 个地点", other: "{n} 个地点" },
    loading: "加载中…",
    none: "此区域没有结果。请缩小地图或清除筛选。",
    filters: { pantries: "食物领取点", events: "发放活动", today: "今天", noId: "无需证件", clear: "清除" },
    tagLabels: {
      shelf_stable: "常温食品", prepared: "熟食", delivery: "送货上门",
      halal: "清真", kosher: "洁食", baby: "婴儿食品",
    },
    card: { programs: { one: "{n} 个项目", other: "{n} 个项目" }, noId: "无需证件", bring: "请携带：{x}", directions: "路线", call: "拨打电话" },
    apply: {
      action: "申请",
      applied: "已申请",
      title: "申请：{name}",
      submit: "提交申请",
      success: "申请已提交。",
      processing: "通常约 {n} 天内答复。",
      required: "请填写此项",
      mine: "我的申请",
      withdraw: "撤回",
      empty: "您还没有提交任何申请。",
    },
    status: {
      submitted: "已提交", in_review: "审核中", approved: "已通过",
      denied: "未通过", withdrawn: "已撤回",
    },
    auth: {
      signIn: "登录", signOut: "退出",
      title: "用手机号登录",
      sub: "我们会发送 6 位验证码。无需密码。",
      phoneLabel: "您的手机号码",
      codeLabel: "6 位验证码",
      send: "发送验证码", verify: "登录", resend: "重新发送验证码",
      wrongCode: "验证码不正确。请重试。",
      expired: "验证码已过期。请重新发送。",
      tooMany: "尝试次数过多。请重新发送验证码。",
    },
    chat: {
      placeholder: "询问附近的食物",
      locked: "登录后即可提问",
      send: "发送",
      title: "提问",
      intro: "可以问我今天在哪里领取食物、可以申请哪些项目、需要带什么。",
    },
    close: "关闭",
    mapUnavailable: "地图尚未配置。列表仍可使用。",
  directions: {
    title: "路线",
    walk: "步行", transit: "公共交通", drive: "开车", bike: "骑车",
    lessWalking: "少走路", fewerTransfers: "少换乘",
    minutes: "{n} 分钟", openInMaps: "在谷歌地图中打开",
    noRoute: "无法生成路线。请在谷歌地图中打开。",
    useMyLocation: "使用我的位置",
    locationDenied: "定位已关闭，将使用您的邮政编码。",
    board: "乘坐 {line}，方向 {headsign}",
    getOff: "在 {stop} 下车",
    fare: "车费约 {x}",
    caveat: "“少走路”不等于无台阶路线。如有需要请提前致电确认。",
  },
  access: {
    title: "无障碍设施",
    unknown: "未标注 — 请致电确认",
    filter: "轮椅通道",
    labels: {
      wheelchair: "轮椅可通行", step_free: "无台阶",
      accessible_restroom: "无障碍卫生间", seating: "有座位",
      near_transit: "靠近公交站", parking: "无障碍停车位",
      asl: "提供手语", service_animal_ok: "可携带服务犬",
    },
  },
  },
  es: {
    title: "Comida gratis cerca de usted",
    searchArea: "Buscar en esta área",
    places: { one: "1 lugar", other: "{n} lugares" },
    loading: "Cargando…",
    none: "No hay nada en esta área. Aleje el mapa o quite los filtros.",
    filters: { pantries: "Despensas", events: "Eventos", today: "Hoy", noId: "Sin identificación", clear: "Quitar" },
    tagLabels: {
      shelf_stable: "No perecedero", prepared: "Comida caliente", delivery: "Entrega",
      halal: "Halal", kosher: "Kosher", baby: "Comida de bebé",
    },
    card: { programs: { one: "1 programa", other: "{n} programas" }, noId: "No necesita identificación", bring: "Traiga: {x}", directions: "Cómo llegar", call: "Llamar" },
    apply: {
      action: "Solicitar",
      applied: "Solicitado",
      title: "Solicitar: {name}",
      submit: "Enviar solicitud",
      success: "Solicitud enviada.",
      processing: "Suele responderse en unos {n} días.",
      required: "Complete este campo",
      mine: "Mis solicitudes",
      withdraw: "Retirar",
      empty: "Todavía no ha enviado ninguna solicitud.",
    },
    status: {
      submitted: "Enviada", in_review: "En revisión", approved: "Aprobada",
      denied: "No aprobada", withdrawn: "Retirada",
    },
    auth: {
      signIn: "Iniciar sesión", signOut: "Cerrar sesión",
      title: "Entre con su teléfono",
      sub: "Le enviaremos un código de 6 dígitos. Sin contraseña.",
      phoneLabel: "Su número de celular",
      codeLabel: "Código de 6 dígitos",
      send: "Enviar código", verify: "Entrar", resend: "Enviar un código nuevo",
      wrongCode: "Ese código no coincide. Intente de nuevo.",
      expired: "Ese código venció. Envíe uno nuevo.",
      tooMany: "Demasiados intentos. Envíe un código nuevo.",
    },
    chat: {
      placeholder: "Pregunte sobre comida cerca",
      locked: "Inicie sesión para preguntar",
      send: "Enviar",
      title: "Preguntar",
      intro: "Pregúnteme dónde conseguir comida hoy, qué puede solicitar o qué llevar.",
    },
    close: "Cerrar",
    mapUnavailable: "El mapa no está configurado. La lista sigue funcionando.",
  directions: {
    title: "Cómo llegar",
    walk: "Caminando", transit: "Transporte", drive: "En carro", bike: "En bici",
    lessWalking: "Caminar menos", fewerTransfers: "Menos transbordos",
    minutes: "{n} min", openInMaps: "Abrir en Google Maps",
    noRoute: "No pudimos crear una ruta. Ábrala en Google Maps.",
    useMyLocation: "Usar mi ubicación",
    locationDenied: "La ubicación está apagada; usamos su código postal.",
    board: "Tome el {line} hacia {headsign}",
    getOff: "Bájese en {stop}",
    fare: "Pasaje aproximado {x}",
    caveat: "\"Caminar menos\" no es lo mismo que una ruta sin escalones. Llame antes si la necesita.",
  },
  access: {
    title: "Accesibilidad",
    unknown: "No indicado — llame para confirmar",
    filter: "Acceso en silla de ruedas",
    labels: {
      wheelchair: "Accesible en silla de ruedas", step_free: "Sin escalones",
      accessible_restroom: "Baño accesible", seating: "Hay asientos",
      near_transit: "Cerca del transporte", parking: "Estacionamiento accesible",
      asl: "Lenguaje de señas", service_animal_ok: "Se permiten animales de servicio",
    },
  },
  },
};

/**
 * Chinese has one form, English and Spanish have two. Intl.PluralRules picks
 * the right bucket per locale rather than hardcoding an "n === 1" rule that is
 * wrong somewhere.
 */
export function plural(
  locale: Locale,
  n: number,
  forms: { one: string; other: string },
): string {
  const rule = new Intl.PluralRules(locale).select(n);
  return fill(rule === "one" ? forms.one : forms.other, { n });
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => String(vars[k] ?? m));
}
