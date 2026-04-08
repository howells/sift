import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

interface SpinnerProps {
	detail?: string;
	message: string;
	step?: number;
	totalSteps?: number;
}

function progressBar(step: number, total: number): string {
	const filled = "━".repeat(step);
	const empty = "─".repeat(total - step);
	return `${filled}${empty}`;
}

export function Spinner({ detail, message, step, totalSteps }: SpinnerProps) {
	return (
		<Box alignItems="center" flexDirection="column">
			<Box>
				<Text color="cyan">
					<InkSpinner type="dots" />
				</Text>
				<Text> {message}</Text>
			</Box>
			{step !== undefined && totalSteps !== undefined && (
				<Box marginTop={1}>
					<Text color="cyan">{progressBar(step, totalSteps)}</Text>
					<Text dimColor>
						{" "}
						{step}/{totalSteps}
					</Text>
				</Box>
			)}
			{detail && <Text dimColor>{detail}</Text>}
		</Box>
	);
}
