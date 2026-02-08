import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk";
import { z } from "zod";

const configSchema = z.object({
	schedule: z.string(),
});

type Config = z.infer<typeof configSchema>;

const onCronTrigger = (runtime: Runtime<Config>): string => {
	runtime.log("PRISM Risk Monitor Active");
	return "PRISM Risk Monitor Active";
};

const initWorkflow = (config: Config) => {
	const cron = new CronCapability();

	return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
