import { info } from '@actions/core';
import { GitHub, context } from '@actions/github';
import { loadIssue } from './issue';
import { loadPr } from './pr';
import { Action, ActionType } from './types';
import { getAction, getConfig } from './init';

async function main() {
  const actionInfo = getAction(context);
  if (!actionInfo.action) {
    info(`Skipping event ${event}`);
    return;
  }

  const config = getConfig();
  const octokit = new GitHub(config.token);
  const { projectName } = config;

  if (actionInfo.actionType === ActionType.Issue) {
    info(`Processing an issue event: ${context.payload.action}`);

    const issue = await loadIssue(
      octokit,
      context.payload.issue.html_url,
      projectName
    );

    if (issue.projectCard || config.autoAdd) {
      switch (actionInfo.action) {
        case Action.IssueOpened:
          info(`Issue ${issue.number} was opened`);

          if (issue.isAssigned()) {
            info(`Issue ${issue.number} is assigned`);

            if (config.workingColumnName) {
              // If the issue is already assigned, move it to the working column
              info(`Moving issue ${issue.number} to working column`);
              await issue.moveToColumn(config.workingColumnName);
            }
          } else if (config.triagedLabels.some((lbl) => issue.hasLabel(lbl))) {
            info(`Issue ${issue.number} has already been triaged`);

            if (config.todoColumnName) {
              // If the issue is already assigned, move it to the working column
              info(`Moving issue ${issue.number} to todo column`);
              await issue.moveToColumn(config.todoColumnName);
            }
          } else {
            info(`Issue ${issue.number} is not assigned or triaged`);

            // If we have a triage label, apply it to new issues
            if (config.triageLabel) {
              info(`Adding triage label to ${issue.number}`);
              await issue.addLabel(config.triageLabel);
            }

            // If we have a triage column, put new issues in it
            if (config.triageColumnName) {
              info(`Moving issue ${issue.number} to triage column`);
              await issue.moveToColumn(config.triageColumnName);
            } else if (config.workingColumnName) {
              info(`Moving issue ${issue.number} to working column`);
              await issue.moveToColumn(config.workingColumnName);
            }
          }
          break;

        case Action.IssueClosed:
          info(`Issue ${issue.number} was closed`);

          // If an issue is closed, it's done
          if (config.doneColumnName) {
            info(`Moving issue ${issue.number} to done column`);
            await issue.moveToColumn(config.doneColumnName);
          }
          break;

        case Action.IssueReopened:
          info(`Issue ${issue.number} was reopened`);

          // If an issue is reopened and is assigned, it's in progress, otherwise
          // it's todo
          if (issue.isAssigned() && config.workingColumnName) {
            info(`Issue ${issue.number} is assigned; moving to working column`);
            await issue.moveToColumn(config.workingColumnName);
          } else if (!issue.isAssigned() && config.todoColumnName) {
            info(
              `Issue ${issue.number} is not assigned; moving to todo column`
            );
            await issue.moveToColumn(config.todoColumnName);
          }
          break;

        case Action.IssueAssignment:
          info(`Issue ${issue.number} was assigned`);

          // If a triaged or todo issue is assigned, it's in progress
          if (issue.isAssigned() && config.workingColumnName) {
            if (
              (config.todoColumnName &&
                issue.isInColumn(config.todoColumnName)) ||
              (config.triageColumnName &&
                issue.isInColumn(config.triageColumnName))
            ) {
              info(`Moving issue ${issue.number} to working column`);
              await issue.moveToColumn(config.workingColumnName);

              if (config.triageLabel && issue.hasLabel(config.triageLabel)) {
                info(`Removing triage label from issue ${issue.number}`);
                await issue.removeLabel(config.triageLabel);
              }
            }
          } else if (!issue.isAssigned() && config.todoColumnName) {
            info(`Issue ${issue.number} is not assigned`);
            if (
              config.workingColumnName &&
              issue.isInColumn(config.workingColumnName)
            ) {
              info(`Moving ${issue.number} to todo column`);
              await issue.moveToColumn(config.todoColumnName);
            }
          }
          break;

        case Action.IssueLabeling:
          info(`Issue ${issue.number} was relabeled`);

          if (config.triageLabel) {
            if (issue.hasLabel(config.triageLabel)) {
              if (
                config.triageColumnName &&
                !issue.isInColumn(config.triageColumnName)
              ) {
                info(`Moving ${issue.number} to triage column`);
                await issue.moveToColumn(config.triageColumnName);
              }
            } else {
              if (
                config.todoColumnName &&
                !issue.isInColumn(config.todoColumnName)
              ) {
                info(`Moving ${issue.number} to todo column`);
                await issue.moveToColumn(config.todoColumnName);
              }
            }
          }
          break;
      }
    }
  } else {
    info(`Processing a PR event: ${context.payload.action}`);

    const pr = await loadPr(octokit, context.payload.pull_request.html_url);
    const linkedIssues = await pr.findLinkedIssues(projectName);

    switch (actionInfo.action) {
      case Action.PrOpened:
        info(`PR ${pr.number} was opened`);

        for (const issue of linkedIssues) {
          info(`Checking referenced issue ${issue.number}`);

          if (
            (config.todoColumnName &&
              issue.isInColumn(config.todoColumnName)) ||
            (config.triageColumnName &&
              issue.isInColumn(config.triageColumnName))
          ) {
            if (config.workingColumnName) {
              info(`Moving issue ${issue.number} to working column`);
              await issue.moveToColumn(config.workingColumnName);
            }

            if (config.triageLabel && issue.hasLabel(config.triageLabel)) {
              info(`Removing triage label from ${issue.number}`);
              await issue.removeLabel(config.triageLabel);
            }
          }
        }
        break;

      case Action.PrClosed:
        info(`PR ${pr.number} was closed`);

        for (const issue of linkedIssues) {
          info(`Checking referenced issue ${issue.number}`);

          if (
            config.workingColumnName &&
            issue.isInColumn(config.workingColumnName) &&
            config.todoColumnName &&
            !issue.isAssigned() &&
            !issue.linkedPrs.some((pr) => !pr.closed)
          ) {
            info(`Moving issue ${issue.number} to todo column`);
            await issue.moveToColumn(config.todoColumnName);
          }
        }
        break;
    }
  }
}

main().catch((error) => console.error(error));
