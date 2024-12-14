import { Composer, Context, Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { BOT_TOKEN } from "./env";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
// // @ts-expect-error no types
import S3Session from "./telegraf-session-s3-local";
// import S3Session from "telegraf-session-s3"; // TODO: fork telegraf-session-s3 and rewrite in TypeScript + modern aws sdk
import {
  Stage,
  WizardContext,
  WizardScene,
  WizardSession,
} from "telegraf/scenes";
import ShortUniqueId from "short-unique-id";
import { setTimeout } from "node:timers/promises";

const uid = new ShortUniqueId({ length: 10 });

// Fisher-Yates shuffle algorithm (Durstenfeld in-place version)
function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

const rand = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

type Game = {
  id: string;
  name: string;
  giftCost: number;
};

type Participant = {
  participantName: string;
  participantGiftWish: string;
  ward?: string;
};

type Participants = {
  [chatId: string]: Participant;
};

enum SceneId {
  CreateGame = "CREATE_GAME",
  JoinGame = "JOIN_GAME",
}

type BotSession = {
  // abc: number;
  // [userId: number]: {
  // status?: Status;

  // songName?: string;
  // songLyrics?: string;
  creatorName: string;

  gameName: string;
  gameGiftCost: number;

  participantName: string;
};

// type BotContext = Context & {
//   session: BotSession;
// };

type BotContext = WizardContext & {
  session: WizardSession & BotSession;
};

enum ActionId {
  Join = "JOIN",
  StartRaffle = "START_RAFFLE",
}

const COMMON_EXIT_COMMANDS = ["exit", "quit", "leave", "cancel"];

export const bot = new Telegraf<BotContext>(BOT_TOKEN);

// Define the type for the value you want to store
interface KeyValue {
  [key: string]: any;
}

// Your S3 bucket name
const BUCKET_NAME = process.env.AWS_S3_BUCKET;
// Installing Object Storage region
// const REGION = "ru-central1";
// // Installing Object Storage endpoint
// const ENDPOINT = "https://storage.yandexcloud.net";

// Creating a client for Object Storage (explicit configuration from env)
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Store a key-value pair in S3
async function setItem(key: string, value: any) {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(value), // TODO: make better object serialization algorithm
      ContentType: "application/json",
    });

    await s3Client.send(command);
    console.log(`Stored ${key}: ${value}`);
  } catch (err) {
    console.error("Error storing item:", err);
  }
}

// Retrieve a value by key
async function getItem<T>(key: string): Promise<T | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const data = await s3Client.send(command);
    const body = await streamToString(data.Body!); // Convert stream to string
    return JSON.parse(body); // Assuming the value is stored as a JSON string
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "Code" in error &&
      error?.Code === "NoSuchKey"
    ) {
      return null;
    }

    throw error;
  }
}

// Delete a key-value pair from S3
async function deleteItem(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`Deleted key: ${key}`);
  } catch (err) {
    console.error("Error deleting item:", err);
  }
}

// Helper function to convert a stream to string (needed for GetObjectCommand)
function streamToString(
  stream: any // NonNullable<GetObjectCommandOutput["Body"]>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    );
    stream.on("error", reject);
  });
}

const s3Session = new S3Session({
  bucket: process.env.AWS_S3_BUCKET,
});
bot.use(s3Session.middleware());

bot.use(async (context, next) => {
  console.log("before context.session", context.session);
  await next();
  console.log("after context.session", context.session);
});

// @ts-expect-error session type is compatible
const joinGameWizard = new WizardScene<BotContext>(
  SceneId.JoinGame,
  async (context) => {
    console.log("step 1");

    context.wizard.next();
    // await setTimeout(1000);

    await context.reply(
      "Для того, чтобы присоединиться к игре для начала введи 🌝 свое имя (так чтобы другие поняли кому им повезет дарить подарок):"
    );
  },
  async (context) => {
    console.log("step 2");
    if (context.has(message("text"))) {
      context.wizard.next();
      // await setTimeout(1000);

      const participantName = context.message.text;
      context.session.participantName = participantName;

      const game = (await getItem<Game>("game"))!;

      await context.reply(
        `Отлично, напиши свое пожелание к 🎁 подарку, помни что стоимость подарка не должна превышать ${game.giftCost} руб. (если стоимость твоего подарка ниже лимита - опиши чтобы ты хотел получить на остаток: конфетки или тд 😁)`
      );
    } else {
      await context.reply("Пожалуйста введи свое имя:");
    }
  },
  async (context) => {
    console.log("step 3");
    if (context.has(message("text"))) {
      await context.scene.leave();

      const participantGiftWish = context.message.text;
      const participantName = context.session.participantName;

      const participants =
        (await getItem<Participants>("participants")) ?? {};
      participants[context.chat.id] = {
        participantName,
        participantGiftWish,
      };
      await setItem("participants", participants);

      await context.reply(
        `Отлично, ${participantName} спасибо за то что присоединился к игре) , ожидай того как администратор начнет жеребьевку и готовься узнать имя твоего подопечного!`
      );
    } else {
      // await context.reply("You must enter app name:");
      await context.reply("Пожалуйста опиши пожелание к подарку:");
    }
  }
);

// exit, cancel, quit, leave
joinGameWizard.command(COMMON_EXIT_COMMANDS, async (context) => {
  await context.scene.leave();
  // clearNativefySession(context);
  await context.reply("Создавайте игру в следующий раз!");
});

joinGameWizard.use(async (context, next) => {
  try {
    await next();
  } catch (error) {
    // await context.reply(
    //   "⚠️ Error while trying to convert website to app",
    //   Markup.removeKeyboard()
    // );
    await context.scene.leave();
    throw error;
  }
});

bot.start(async (context) => {
  await context.reply(
    "Привет, это 🧙‍♂️ Тайный Волхв. Заходи сюда и скорее участвуй в 🎄 рождественской игре, чтобы подарить тайный подарок твоему другу!!"
  );

  const game = await getItem<Game>("game");
  const participants = (await getItem<Participants>("participants")) || {};
  const participantsCount = Object.keys(participants).length;

  if (game) {
    console.log("ActionId.Join sent");
    await context.replyWithHTML(
      `Игра <b>${game.name}</b> ID ${game.id} со стоимостью подарка <u>${game.giftCost} руб.</u>\n\nДля участия в игре нажми на кнопку "Присоединиться" к тайным волхвам (на данный момент участвуют ${participantsCount} волхвов)`,
      {
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            // questionCancelButtonMessage,
            "Присоединиться",
            ActionId.Join
          ),
        ]),
        disable_notification: true,
      }
    );
  }

  // // @ts-ignore
  // context.session.__scenes = {};
});

// @ts-expect-error session type is compatible
const createGameWizard = new WizardScene<BotContext>(
  SceneId.CreateGame,
  async (context) => {
    console.log("step 1");

    context.wizard.next();
    // await setTimeout(1000);

    await context.reply(
      "Привет, для того чтобы создать новую игру введи название:"
    );
  },
  async (context) => {
    console.log("step 2");
    if (context.has(message("text"))) {
      context.wizard.next();
      // await setTimeout(1000);

      const gameName = context.message.text;

      context.session.gameName = gameName;

      await context.reply(
        "Теперь введи стоимость в руб, на которую нужно дарить подарок:"
      );
    } else {
      await context.reply("Пожалуйста введи название:");
    }
  },
  async (context) => {
    console.log("step 3");
    if (context.has(message("text"))) {
      await context.scene.leave();
      // await setTimeout(1000);

      const gameName = context.session.gameName;
      const gameGiftCost = +context.message.text; // TODO: add validation for number, etc.
      const gameId = uid.rnd(); // p0ZoB1FwH6

      // TODO: make support for MANY games
      await setItem("game", {
        id: gameId,
        name: gameName,
        giftCost: gameGiftCost,
      } as Game);

      await context.reply(
        `Игра "${gameName}" успешно создана с ID - ${gameId} и стоимостью подарка - ${gameGiftCost} руб`
      );
    } else {
      // await context.reply("You must enter app name:");
      await context.reply("Пожалуйста введи название:");
    }
  }
);

// exit, cancel, quit, leave
createGameWizard.command(COMMON_EXIT_COMMANDS, async (context) => {
  await context.scene.leave();
  // clearNativefySession(context);
  await context.reply("Создавайте игру в следующий раз!");
});

createGameWizard.use(async (context, next) => {
  try {
    await next();
  } catch (error) {
    // await context.reply(
    //   "⚠️ Error while trying to convert website to app",
    //   Markup.removeKeyboard()
    // );
    await context.scene.leave();
    throw error;
  }
});

// Disable bot in group chats
bot.use(Composer.drop((context) => context.chat?.type !== "private"));

// bot.use(localSession.middleware());

bot.use(async (context, next) => {
  let typingInterval: NodeJS.Timeout | undefined;
  try {
    if (!context.callbackQuery) {
      await context.sendChatAction("typing");

      typingInterval = setInterval(
        async () => await context.sendChatAction("typing"),
        5000
      );

      // context.forwardMessage(LOGGING_CHANNEL_CHAT_ID);
    }

    await next();
  } finally {
    clearInterval(typingInterval);
  }
});

// @ts-expect-error session type is compatible
const stage = new Stage<WizardContext>([createGameWizard, joinGameWizard]);
bot.use(stage.middleware());

bot.action(ActionId.Join, async (context) => {
  console.log("ActionId.Join handled");
  await context.scene.enter(SceneId.JoinGame);
});

bot.command("create", async (context) => {
  // await context.reply(
  //   "Привет, для того чтобы создать новую игру - давай сначала введем название:"
  // );

  // Set a key-value pair
  // await setItem("user:1234", {
  //   name: "John Doe",
  //   email: "john.doe@example.com",
  // });

  // context.session.creatorName = "John Doe";

  // context.session.link = link;
  context.scene.enter(SceneId.CreateGame);
  // console.log("abc", (context as any).session);
  // if ('session' in context) {
  //   context.session.
  // }
});

bot.command("get", async (context) => {
  // await context.reply(
  //   "Привет, для того чтобы создать новую игру - давай сначала введем название:"
  // );

  // Get the value by key
  // const user = await getItem<KeyValue>("user:1234");
  // const user = context.session.creatorName;
  // console.log("User retrieved:", user);
  const game = (await getItem<Game>("game"))!;

  await context.replyWithHTML(
    `Игра <b>${game.name}</b> ID ${game.id} с стоимостью подарка <u>${game.giftCost} руб.</u>`
  );

  // // Delete the key-value pair
  // await deleteItem("user:1234");
});

bot.command("raffle", async (context) => {
  // await context.reply(
  //   "Привет, для того чтобы создать новую игру - давай сначала введем название:"
  // );

  // Get the value by key
  // const user = await getItem<KeyValue>("user:1234");
  // const user = context.session.creatorName;
  // console.log("User retrieved:", user);
  // const game = (await getItem<Game>("game"))!;

  const participants = (await getItem<Participants>("participants")) || {};
  const participantsCount = Object.keys(participants).length;

  await context.replyWithHTML(
    `Процесс жеребьевки определяет подопечного для каждого из учасников игры (сейчас ${participantsCount} участников), для начала жеребьевки нажми "Начать"\nУчасники:\n${Object.values(
      participants
    )
      .map((participant) => "- " + participant.participantName)
      .join("\n")}`,
    {
      ...Markup.inlineKeyboard([
        Markup.button.callback(
          // questionCancelButtonMessage,
          "Начать",
          ActionId.StartRaffle
        ),
      ]),
      disable_notification: true,
    }
  );

  // // Delete the key-value pair
  // await deleteItem("user:1234");
});

bot.action(ActionId.StartRaffle, async (context) => {
  const participants = (await getItem<Participants>("participants")) ?? {};
  const participantsCount = Object.keys(participants).length;

  if (participantsCount <= 2) {
    await context.reply(
      "Слишком мало учасников, жеребьевка не может быть начата."
    );
    return;
  }

  const participantIds = Object.keys(participants);

  // const leftWards = new Set(participantIds);
  // for (const participantId of participantIds) {
  //   const participant = participants[participantId];
  //   const availableWards = new Set(leftWards);
  //   availableWards.delete(participantId); // you cant gift to yourself
  //   if (participant.ward) {
  //     availableWards.delete(participant.ward); // you cant gift to your magus
  //   }
  //   // console.log("availableWards", availableWards, availableWards.size);
  //   const randomIndex = rand(0, availableWards.size - 1);
  //   console.log("randomIndex", randomIndex);
  //   const randomParticipantId = Array.from(availableWards)[randomIndex];
  //   leftWards.delete(randomParticipantId);
  // }

  shuffleArray(participantIds);
  for (
    let participantIndex = 0;
    participantIndex < participantIds.length;
    participantIndex += 1
  ) {
    const participantId = participantIds[participantIndex];
    const wardId =
      participantIds[participantIndex + 1] ?? participantIds[0];
    participants[participantId].ward = wardId;
  }

  console.log("participants", participants);
  const secretMaguses = [];
  for (const [participantId, participant] of Object.entries(
    participants
  )) {
    const ward = participants[participant.ward!];
    await bot.telegram.sendMessage(
      participantId,
      `Привет, была проведена жеребьевка, тебе повезло и ты будешь дарить подарок <b>"${ward.participantName}"</b> 🎉, вот его/ее пожелание о 🎁 подарке:\n<i>${ward.participantGiftWish}</i>`,
      { parse_mode: "HTML" }
    );

    secretMaguses.push(
      `- ${participant.participantName} => ${ward.participantName}`
    );
  }

  await context.reply(
    `Успешно проведена жеребьевка, все учасники были уведомлены о своих подопечных!!\n\n${secretMaguses.join(
      "\n"
    )}`
  );
});

bot.on(message("text"), async (context) => {
  try {
    const url = new URL(context.message.text);

    await context.reply(url.href, {
      reply_markup: {
        inline_keyboard: [[{ text: "Open", web_app: { url: url.href } }]],
      },
    });
  } catch (error) {
    await context.telegram.sendMessage(
      context.chat.id,
      "Please provide a valid HTTPS URL."
    );
  }
});
