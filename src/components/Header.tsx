import { Box, Text } from "ink";

interface HeaderProps {
	groups: string[];
	selectedGroup: string | null;
	backlogCount?: number;
	isBacklogView?: boolean;
}

export function Header({
	groups,
	selectedGroup,
	backlogCount,
	isBacklogView,
}: HeaderProps) {
	return (
		<Box justifyContent="space-between" marginBottom={1}>
			<Text bold color="cyan">
				sift{isBacklogView ? " › backlog" : ""}
			</Text>
			<Box>
				{groups.map((group, i) => {
					const isSelected = selectedGroup === null || selectedGroup === group;
					const num = i + 1;
					return (
						<Text key={group}>
							<Text color="cyan">[{num}]</Text>
							<Text
								color={isSelected ? "white" : "gray"}
								dimColor={!isSelected}
							>
								{" "}
								{group.charAt(0).toUpperCase() + group.slice(1)}
							</Text>
							{i < groups.length - 1 && <Text> </Text>}
						</Text>
					);
				})}
				{backlogCount !== undefined && backlogCount > 0 && (
					<Text>
						{"  "}
						<Text color="cyan">[b]</Text>
						<Text
							color={isBacklogView ? "yellow" : undefined}
							dimColor={!isBacklogView}
						>
							{" "}
							Backlog ({backlogCount})
						</Text>
					</Text>
				)}
			</Box>
		</Box>
	);
}
