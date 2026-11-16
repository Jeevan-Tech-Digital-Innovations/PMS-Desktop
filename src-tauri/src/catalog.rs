//! Projects → tasks → sub-tasks for the picker, the search index and recent tasks.
//!
//! Only tasks assigned to the employee (assignee or member) are shown, plus parents that lead to an
//! assigned descendant, so every assigned item is reachable by drilling down.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::api::{Api, TimeLog};
use crate::error::AppResult;
use crate::types::{Project, TaskNode, TaskRef};

pub const SEARCH_LIMIT: usize = 30;
pub const RECENT_LIMIT: usize = 5;
const INDEX_TTL: Duration = Duration::from_secs(15 * 60);

fn id_of(v: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|k| match v.get(*k)? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

fn str_of<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k)?.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

fn value_ids(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => s.split(',').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect(),
        Some(Value::Number(n)) => vec![n.to_string()],
        Some(Value::Array(a)) => a.iter().flat_map(|x| value_ids(Some(x))).collect(),
        Some(Value::Object(o)) => ["id", "userId", "memberId"].iter().flat_map(|k| value_ids(o.get(*k))).collect(),
        _ => Vec::new(),
    }
}

/// Assigned directly: `assignee` / `assigneeId` / `members` / `membersString` contains one of `me`.
pub fn is_assigned(task: &Value, me: &HashSet<String>) -> bool {
    if me.is_empty() {
        return true;
    }
    ["assignee", "assigneeId", "members", "membersString"]
        .iter()
        .flat_map(|k| value_ids(task.get(*k)))
        .any(|id| me.contains(&id))
}

fn children(task: &Value) -> Vec<&Value> {
    task.get("subTasks").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

/// Assigned itself or has an assigned descendant.
pub fn is_relevant(task: &Value, me: &HashSet<String>) -> bool {
    is_assigned(task, me) || children(task).into_iter().any(|c| is_relevant(c, me))
}

pub fn task_title(v: &Value) -> String {
    str_of(v, &["title", "projectTaskName", "name"]).unwrap_or("Untitled task").to_string()
}

pub fn to_nodes(list: &[Value], me: &HashSet<String>) -> Vec<TaskNode> {
    list.iter()
        .filter(|t| is_relevant(t, me))
        .filter_map(|t| {
            Some(TaskNode {
                id: id_of(t, &["id", "projectTaskId"])?,
                title: task_title(t),
                status: str_of(t, &["status"]).map(str::to_string),
                has_children: children(t).into_iter().any(|c| is_relevant(c, me)),
            })
        })
        .collect()
}

pub fn parse_project(v: &Value) -> Option<Project> {
    Some(Project {
        id: id_of(v, &["id", "projectId"])?,
        name: str_of(v, &["name", "projectName"]).unwrap_or("Untitled project").to_string(),
        client_name: str_of(v, &["clientName", "clientCompanyName"]).map(str::to_string),
    })
}

/// Flatten a project's task tree into `TaskRef`s for every assigned task (path = chain incl. the task).
pub fn flatten(project: &Project, list: &[Value], me: &HashSet<String>, out: &mut Vec<TaskRef>) {
    fn walk(project: &Project, t: &Value, parents: &[String], me: &HashSet<String>, out: &mut Vec<TaskRef>) {
        let Some(id) = id_of(t, &["id", "projectTaskId"]) else { return };
        let title = task_title(t);
        let mut path = parents.to_vec();
        path.push(title.clone());
        if is_assigned(t, me) {
            out.push(TaskRef {
                task_id: id,
                title,
                project_id: project.id,
                project_name: project.name.clone(),
                path: path.clone(),
            });
        }
        for c in children(t) {
            walk(project, c, &path, me, out);
        }
    }
    for t in list {
        walk(project, t, &[], me, out);
    }
}

pub fn search(index: &[TaskRef], query: &str, limit: usize) -> Vec<TaskRef> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(usize, &TaskRef)> = index
        .iter()
        .filter_map(|t| {
            let hay = format!("{} {} {}", t.title, t.project_name, t.path.join(" ")).to_lowercase();
            if !words.iter().all(|w| hay.contains(w)) {
                return None;
            }
            // Title matches first.
            let title = t.title.to_lowercase();
            let rank = if title.starts_with(&words[0]) { 0 } else if title.contains(&words[0]) { 1 } else { 2 };
            Some((rank, t))
        })
        .collect();
    hits.sort_by_key(|(r, _)| *r);
    hits.into_iter().take(limit).map(|(_, t)| t.clone()).collect()
}

/// Latest distinct tasks from the employee's time logs.
pub fn recent_from_logs(mut logs: Vec<TimeLog>, index: &[TaskRef], limit: usize) -> Vec<TaskRef> {
    logs.sort_by(|a, b| {
        let ka = a.start_time.as_deref().and_then(crate::time::parse_server_ts);
        let kb = b.start_time.as_deref().and_then(crate::time::parse_server_ts);
        kb.cmp(&ka)
    });
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for l in logs {
        let (Some(task_id), Some(project_id)) = (l.task_id, l.project_id) else { continue };
        if !seen.insert(task_id) {
            continue;
        }
        out.push(task_ref_from_log(task_id, project_id, l.task_name.as_deref(), l.project_name.as_deref(), index));
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub fn task_ref_from_log(task_id: i64, project_id: i64, task_name: Option<&str>, project_name: Option<&str>, index: &[TaskRef]) -> TaskRef {
    if let Some(t) = index.iter().find(|t| t.task_id == task_id) {
        return t.clone();
    }
    let title = task_name.unwrap_or("Task").to_string();
    TaskRef {
        task_id,
        title: title.clone(),
        project_id,
        project_name: project_name.unwrap_or("Project").to_string(),
        path: vec![title],
    }
}

#[derive(Default)]
pub struct Catalog {
    index: Mutex<Option<(Vec<TaskRef>, Instant)>>,
}

impl Catalog {
    pub fn clear(&self) {
        if let Ok(mut g) = self.index.lock() {
            *g = None;
        }
    }

    /// Cached index (may be empty if never built).
    pub fn cached(&self) -> Vec<TaskRef> {
        self.index.lock().ok().and_then(|g| g.as_ref().map(|(v, _)| v.clone())).unwrap_or_default()
    }

    pub async fn projects(&self, api: &Api) -> AppResult<Vec<Project>> {
        Ok(api.projects().await?.iter().filter_map(parse_project).collect())
    }

    pub async fn index(&self, api: &Api, me: &HashSet<String>) -> AppResult<Vec<TaskRef>> {
        if let Some((v, at)) = self.index.lock().ok().and_then(|g| g.clone())
            && at.elapsed() < INDEX_TTL
        {
            return Ok(v);
        }
        let projects = self.projects(api).await?;
        let mut out = Vec::new();
        for p in &projects {
            match api.project_tasks(p.id).await {
                Ok(list) => flatten(p, &list, me, &mut out),
                Err(e) => log::warn!("task index: project {} skipped: {e}", p.id),
            }
        }
        if let Ok(mut g) = self.index.lock() {
            *g = Some((out.clone(), Instant::now()));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn me() -> HashSet<String> {
        ["u1".to_string()].into_iter().collect()
    }

    fn tree() -> Vec<Value> {
        vec![
            json!({"id": 1, "title": "Design", "assignee": "U1", "subTasks": [
                {"id": 11, "title": "Hero", "members": ["u2"], "subTasks": []},
                {"id": 12, "title": "Footer", "members": ["u1"], "subTasks": [
                    {"id": 121, "title": "Links", "assigneeId": "u1"}
                ]}
            ]}),
            json!({"id": 2, "title": "Backend", "assignee": "u9", "subTasks": [
                {"id": 21, "title": "API", "membersString": "u3, u1"}
            ]}),
            json!({"id": 3, "title": "Other", "assignee": "u9"}),
        ]
    }

    #[test]
    fn nodes_include_assigned_and_parents_of_assigned() {
        let nodes = to_nodes(&tree(), &me());
        let ids: Vec<i64> = nodes.iter().map(|n| n.id).collect();
        assert_eq!(ids, vec![1, 2]);
        assert!(nodes[0].has_children);
        assert!(nodes[1].has_children);
        let subs = to_nodes(tree()[0]["subTasks"].as_array().unwrap(), &me());
        assert_eq!(subs.iter().map(|n| n.id).collect::<Vec<_>>(), vec![12]);
    }

    #[test]
    fn flatten_and_search() {
        let p = Project { id: 7, name: "Website".into(), client_name: None };
        let mut idx = Vec::new();
        flatten(&p, &tree(), &me(), &mut idx);
        let ids: Vec<i64> = idx.iter().map(|t| t.task_id).collect();
        assert_eq!(ids, vec![1, 12, 121, 21]);
        let links = idx.iter().find(|t| t.task_id == 121).unwrap();
        assert_eq!(links.path, vec!["Design", "Footer", "Links"]);
        assert_eq!(search(&idx, "links", 30)[0].task_id, 121);
        assert_eq!(search(&idx, "footer", 30).len(), 2); // Footer + Links (path)
        assert_eq!(search(&idx, "footer", 30)[0].task_id, 12);
        assert_eq!(search(&idx, "website api", 30)[0].task_id, 21);
        assert!(search(&idx, "   ", 30).is_empty());
        assert_eq!(search(&idx, "e", 2).len(), 2);
    }

    #[test]
    fn recent_tasks_are_latest_distinct() {
        let log = |task: i64, start: &str| TimeLog {
            id: Some(1),
            task_id: Some(task),
            task_name: Some(format!("T{task}")),
            project_id: Some(1),
            project_name: Some("P".into()),
            start_time: Some(start.into()),
            ..Default::default()
        };
        let logs = vec![
            log(1, "2026-11-10T09:00:00"),
            log(2, "2026-11-14T09:00:00"),
            log(1, "2026-11-13T09:00:00"),
            log(3, "2026-11-12T09:00:00"),
        ];
        let r = recent_from_logs(logs, &[], 5);
        assert_eq!(r.iter().map(|t| t.task_id).collect::<Vec<_>>(), vec![2, 1, 3]);
        assert_eq!(r[0].path, vec!["T2"]);
    }

    #[test]
    fn projects_parse() {
        let p = parse_project(&json!({"id": 3, "name": "X", "clientCompanyName": "Acme"})).unwrap();
        assert_eq!(p.client_name.as_deref(), Some("Acme"));
        assert!(parse_project(&json!({"name": "no id"})).is_none());
    }
}
