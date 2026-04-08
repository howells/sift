import { Box, Text } from "ink";

interface HeaderProps {
	backlogCount?: number;
	groups: string[];
	isBacklogView?: boolean;
	selectedGroup: string | null;
	totalItems?: number;
}

export function Header({
	backlogCount,
	groups,
	isBacklogView,
	selectedGroup,
	totalItems,
}: HeaderProps) {
	return (
		<Box justifyContent="space-between" marginBottom={1}>
			<Box>
				<Text bold color="cyan">
					sift
				</Text>
				{isBacklogView && <Text dimColor> › backlog</Text>}
				{totalItems !== undefined && !isBacklogView && (
					<Text dimColor>
						{" "}
						· {totalItems} {totalItems === 1 ? "item" : "items"}
					</Text>
				)}
			</Box>
			<Box>
				{groups.map((group, i) => {
					const isActive = selectedGroup === null || selectedGroup === group;
					return (
						<Text key={group}>
							<Text color="cyan">{i + 1}</Text>
							<Text
								bold={selectedGroup === group}
								color={isActive ? "white" : "gray"}
								dimColor={!isActive}
							>
								{" "}
								{group}
							</Text>
							{i < groups.length - 1 && <Text dimColor> · </Text>}
						</Text>
					);
				})}
				{backlogCount !== undefined && backlogCount > 0 && (
					<Text>
						<Text dimColor> · </Text>
						<Text color="cyan">b</Text>
						<Text
							bold={isBacklogView}
							color={isBacklogView ? "yellow" : undefined}
							dimColor={!isBacklogView}
						>
							{" "}
							backlog ({backlogCount})
						</Text>
					</Text>
				)}
			</Box>
		</Box>
	);
}
